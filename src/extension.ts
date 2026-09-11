import * as vscode from 'vscode';
import {match} from 'ts-pattern';
import {GlmApiClient, GlmApiError} from './api';
import {AuthManager} from './auth';
import {GlmChatProvider, type UsageCallback} from './provider';
import {fetchPlanQuota, type PlanQuota, type PlanWindow} from './quota';
import {TEMPERATURE_PRESETS} from './models';

async function setApiKey(
  authManager: AuthManager,
  provider: GlmChatProvider,
): Promise<void> {
  await authManager.promptForApiKey();
  provider.fireLanguageModelChatInformationChange();
}

async function clearApiKey(
  authManager: AuthManager,
  provider: GlmChatProvider,
): Promise<void> {
  await authManager.deleteApiKey();
  provider.fireLanguageModelChatInformationChange();
  vscode.window.showInformationMessage('GLM API key cleared');
}

async function testConnection(
  authManager: AuthManager,
  provider: GlmChatProvider,
): Promise<void> {
  const resolved = await provider.resolveApiKey();
  if (!resolved) {
    const shouldSetKey = await vscode.window.showInformationMessage(
      'No API key configured. Set one in the provider settings for Z.AI GLM, or use "GLM: Set API Key", then run this test again.',
      'Set API Key',
    );
    if (shouldSetKey === 'Set API Key') {
      await setApiKey(authManager, provider);
    }
    return;
  }

  const client = new GlmApiClient(resolved.key);
  try {
    await client.ping('glm-5.3-flash', [{role: 'user', content: 'Ping'}], {
      maxTokens: 1,
    });
    vscode.window.showInformationMessage('GLM provider test succeeded.');
  } catch (error) {
    const message = match(error)
      .when(
        (value): value is GlmApiError =>
          value instanceof GlmApiError && value.statusCode === 401,
        () => 'Invalid API key. Please set a new key.',
      )
      .when(
        (value): value is Error => value instanceof Error,
        value => `GLM provider test failed: ${value.message}`,
      )
      .otherwise(value => `GLM provider test failed: ${String(value)}`);
    vscode.window.showErrorMessage(message);
  }
}

async function setThinkingEffort(): Promise<void> {
  const config = vscode.workspace.getConfiguration('glm-models-provider');
  const current = config.get<string>('defaultThinkingMode', 'auto');

  const items = [
    {
      label: 'Auto',
      description: 'API default effort level (max)',
      value: 'auto',
      picked: current === 'auto',
    },
    {
      label: 'Low',
      description: 'Lightweight reasoning — fastest responses',
      value: 'low',
      picked: current === 'low',
    },
    {
      label: 'High',
      description: 'Enhanced reasoning',
      value: 'high',
      picked: current === 'high',
    },
    {
      label: 'Max',
      description: 'Deep reasoning — best for complex tasks (default)',
      value: 'max',
      picked: current === 'max',
    },
  ];

  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select thinking effort for GLM models',
  });

  if (!choice) {
    return;
  }

  await config.update('defaultThinkingMode', choice.value, true);
  vscode.window.showInformationMessage(
    `GLM thinking effort set to ${choice.label}`,
  );
}

async function setTemperature(): Promise<void> {
  const selection = await vscode.window.showQuickPick(
    [
      ...TEMPERATURE_PRESETS.map(preset => ({
        label: preset.label,
        description: `${preset.value} — ${preset.description}`,
        value: preset.value as number | undefined,
      })),
      {
        label: 'Custom',
        description: 'Enter your own value (0.0 - 1.0)',
        value: undefined,
      },
    ],
    {placeHolder: 'Select temperature for GLM models'},
  );

  if (!selection) return;

  let value: number;
  if (selection.value === undefined) {
    const input = await vscode.window.showInputBox({
      prompt: 'Enter temperature value (0.0 - 1.0)',
      validateInput: text => {
        const parsed = Number.parseFloat(text);
        if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
          return 'Value must be a number between 0.0 and 1.0';
        }
        return undefined;
      },
    });
    if (!input) return;
    value = Number.parseFloat(input);
  } else {
    value = selection.value;
  }

  await vscode.workspace
    .getConfiguration('glm-models-provider')
    .update('temperature', value, true);
  vscode.window.showInformationMessage(`GLM temperature set to ${value}`);
}

interface UsageTotals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return String(tokens);
}

function formatCountdown(ms: number): string {
  if (ms <= 0) {
    return 'now';
  }
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

function describePlanWindow(win: PlanWindow): string {
  let line = `${win.label}: ${100 - win.usedPercent}% remaining`;
  if (win.remaining !== undefined) {
    line += ` (${formatTokenCount(win.remaining)} tokens)`;
  }
  if (win.resetTime !== undefined) {
    line += ` · resets in ${formatCountdown(win.resetTime - Date.now())}`;
  }
  return line;
}

export function activate(context: vscode.ExtensionContext): void {
  const authManager = new AuthManager(context.secrets);
  const outputChannel = vscode.window.createOutputChannel(
    'GLM Models Provider',
  );

  const usage: UsageTotals = {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
  };

  let planQuota: PlanQuota | undefined;
  let quotaStatus: string | undefined;
  let lastQuotaFetchAt = 0;
  let quotaRefreshInFlight = false;

  const usageStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  usageStatusBarItem.text = 'GLM: $(database) 0 req';
  usageStatusBarItem.tooltip = 'No requests yet this session. Click to manage.';
  usageStatusBarItem.command = 'glm-models-provider.manage';

  const updateUsageStatusBar = (): void => {
    const quotaSegments: string[] = [];
    if (planQuota?.fiveHour) {
      quotaSegments.push(`5h ${100 - planQuota.fiveHour.usedPercent}%`);
    }
    if (planQuota?.weekly) {
      quotaSegments.push(`wk ${100 - planQuota.weekly.usedPercent}%`);
    }
    const quotaSuffix = quotaSegments.length
      ? ` · ${quotaSegments.join(' · ')}`
      : '';

    if (usage.requests === 0 && !planQuota && !quotaStatus) {
      usageStatusBarItem.text = 'GLM: $(database) 0 req';
      usageStatusBarItem.tooltip =
        'No requests yet this session. Click to manage.';
      return;
    }
    usageStatusBarItem.text = `GLM: $(database) ${usage.requests} req · ${formatTokenCount(usage.totalTokens)} tok${quotaSuffix}`;
    const tooltip = [
      'GLM usage this session',
      `Requests: ${usage.requests}`,
      `Prompt tokens: ${usage.promptTokens.toLocaleString()} (cached ${usage.cachedTokens.toLocaleString()})`,
      `Completion tokens: ${usage.completionTokens.toLocaleString()}`,
      `Total tokens: ${usage.totalTokens.toLocaleString()}`,
    ];
    if (planQuota?.fiveHour || planQuota?.weekly) {
      tooltip.push('');
      tooltip.push(
        `Z.AI Coding Plan${planQuota.planName ? ` (${planQuota.planName})` : ''}`,
      );
      if (planQuota.fiveHour) {
        tooltip.push(describePlanWindow(planQuota.fiveHour));
      }
      if (planQuota.weekly) {
        tooltip.push(describePlanWindow(planQuota.weekly));
      }
    } else if (quotaStatus) {
      tooltip.push('');
      tooltip.push(`Plan quota: ${quotaStatus}`);
    }
    tooltip.push('Click to manage provider');
    usageStatusBarItem.tooltip = tooltip.join('\n');
  };

  // Declared ahead of the quota machinery that closes over it. The three are
  // mutually dependent — refreshPlanQuota needs the provider to resolve a key,
  // and the usage callback needs refreshPlanQuota — so the callback is passed
  // indirectly to break the cycle rather than relying on call-time ordering.
  const provider = new GlmChatProvider(
    authManager,
    (tokenUsage, modelId) => onUsage(tokenUsage, modelId),
    message =>
      outputChannel.appendLine(
        `[${new Date().toLocaleTimeString()}] ${message}`,
      ),
  );

  const refreshPlanQuota = async (notify: boolean): Promise<void> => {
    if (quotaRefreshInFlight) {
      return;
    }
    const resolved = await provider.resolveApiKey();
    if (!resolved) {
      quotaStatus = 'no API key configured';
      updateUsageStatusBar();
      usageStatusBarItem.show();
      return;
    }
    quotaRefreshInFlight = true;
    try {
      planQuota = await fetchPlanQuota(resolved.key);
      lastQuotaFetchAt = Date.now();
      const parts: string[] = [];
      if (planQuota.fiveHour) {
        parts.push(describePlanWindow(planQuota.fiveHour));
      }
      if (planQuota.weekly) {
        parts.push(describePlanWindow(planQuota.weekly));
      }
      if (parts.length) {
        quotaStatus = 'ok';
        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString()}] Plan quota${planQuota.planName ? ` (${planQuota.planName})` : ''}: ${parts.join(' — ')}`,
        );
      } else {
        quotaStatus = `no plan windows found (${(planQuota.limitTypes ?? []).join(', ') || 'no limits in response'})`;
        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString()}] Plan quota: ${quotaStatus}`,
        );
      }
      if (notify) {
        const summary = parts.length
          ? parts.join('\n')
          : (quotaStatus ?? 'No coding plan quota windows reported.');
        vscode.window.showInformationMessage(`GLM plan quota:\n${summary}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      quotaStatus = message;
      outputChannel.appendLine(
        `[${new Date().toLocaleTimeString()}] Plan quota refresh failed: ${message}`,
      );
      if (notify) {
        vscode.window.showErrorMessage(
          `GLM plan quota unavailable: ${message}`,
        );
      }
    } finally {
      quotaRefreshInFlight = false;
    }
    updateUsageStatusBar();
    usageStatusBarItem.show();
  };

  const onUsage: UsageCallback = (tokenUsage, modelId) => {
    usage.requests += 1;
    usage.promptTokens += tokenUsage.prompt_tokens;
    usage.completionTokens += tokenUsage.completion_tokens;
    usage.cachedTokens += tokenUsage.cached_tokens ?? 0;
    usage.totalTokens += tokenUsage.total_tokens;

    outputChannel.appendLine(
      `[${new Date().toLocaleTimeString()}] ${modelId ?? 'glm'} — request #${usage.requests}: ` +
        `prompt ${tokenUsage.prompt_tokens.toLocaleString()} (cached ${(tokenUsage.cached_tokens ?? 0).toLocaleString()}), ` +
        `completion ${tokenUsage.completion_tokens.toLocaleString()}, ` +
        `total ${tokenUsage.total_tokens.toLocaleString()} tokens`,
    );

    updateUsageStatusBar();
    usageStatusBarItem.show();

    // Throttle quota refreshes so busy sessions don't hammer the monitor endpoint.
    if (Date.now() - lastQuotaFetchAt > 60_000) {
      void refreshPlanQuota(false);
    }
  };

  const manageActions: Record<string, () => Promise<void>> = {
    'Set API Key': () => setApiKey(authManager, provider),
    'Clear API Key': () => clearApiKey(authManager, provider),
    'Test Connection': () => testConnection(authManager, provider),
    'Refresh Plan Usage': () => refreshPlanQuota(true),
    'Show Usage Log': () => Promise.resolve(outputChannel.show(true)),
  };

  const quotaPollMs = 5 * 60 * 1000;
  const quotaTimer = setInterval(
    () => void refreshPlanQuota(false),
    quotaPollMs,
  );
  void refreshPlanQuota(false);

  context.subscriptions.push(
    usageStatusBarItem,
    outputChannel,
    new vscode.Disposable(() => clearInterval(quotaTimer)),
    vscode.lm.registerLanguageModelChatProvider('zai', provider),
    vscode.commands.registerCommand(
      'glm-models-provider.setApiKey',
      async () => {
        await setApiKey(authManager, provider);
      },
    ),
    vscode.commands.registerCommand(
      'glm-models-provider.clearApiKey',
      async () => {
        await clearApiKey(authManager, provider);
      },
    ),
    vscode.commands.registerCommand('glm-models-provider.manage', async () => {
      const choice = await vscode.window.showQuickPick(
        Object.keys(manageActions),
        {
          placeHolder: 'Manage Z.AI GLM provider',
        },
      );
      const action = choice ? manageActions[choice] : undefined;
      if (!action) {
        return;
      }
      await action();
    }),
    vscode.commands.registerCommand(
      'glm-models-provider.setThinkingEffort',
      async () => {
        await setThinkingEffort();
      },
    ),
    vscode.commands.registerCommand(
      'glm-models-provider.setTemperature',
      async () => {
        await setTemperature();
      },
    ),
  );
}

export function deactivate(): void {}
