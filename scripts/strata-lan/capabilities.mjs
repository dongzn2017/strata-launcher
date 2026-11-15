import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function launcherDefaults(health, props, runsRoot = path.join(root, 'runtime/strata-launcher/runs'), models = null, port = 8080) {
  const matches = [];
  for (const item of fs.readdirSync(runsRoot, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    try {
      const dir = path.join(runsRoot, item.name);
      const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
      if (run.model !== health.model || run.settings.context !== health.max_context || !!run.vision !== !!health.images) continue;
      const configBytes = fs.readFileSync(path.join(dir, 'model.json'));
      if (createHash('sha256').update(configBytes).digest('hex') !== run.configHash) continue;
      const config = JSON.parse(configBytes);
      if (config.model_name !== health.model || config.port !== port || config.host !== '127.0.0.1') continue;
      const aliased = run.clientModel && run.clientModel !== run.model;
      if (aliased && (!config.aliases?.includes(run.clientModel) || !models?.data?.some(m => m.id === run.clientModel && m.alias_of === health.model))) continue;
      const sharedFile = path.join(dir, 'model.shared-settings.json');
      const sharedBytes = fs.readFileSync(sharedFile);
      if (createHash('sha256').update(sharedBytes).digest('hex') !== run.sharedHash) continue;
      const shared = JSON.parse(sharedBytes);
      if (shared.max_tokens !== props.default_generation_settings?.params?.n_predict) continue;
      if (!Number.isInteger(shared.reasoning_budget_tokens) || shared.reasoning_budget_tokens < 0 || shared.reasoning_budget_tokens >= shared.max_tokens) continue;
      if (!['off', 'none', 'low', 'medium', 'high', 'xhigh'].includes(shared.reasoning_effort)) continue;
      matches.push({ max_tokens: shared.max_tokens, reasoning_budget_tokens: shared.reasoning_budget_tokens,
        reasoning_effort: shared.reasoning_effort === 'none' ? 'off' : shared.reasoning_effort, ...(aliased ? {api_model: run.clientModel, server_model: health.model} : {}) });
    } catch { /* Incomplete or unrelated runs are not capability evidence. */ }
  }
  const unique = new Map(matches.map(value => [JSON.stringify(value), value]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}

export function describeCapabilities(health, props, defaults, publicBase = 'http://127.0.0.1:8081') {
  const context = health.max_context;
  if (health.service !== 'strata' || health.status !== 'ok' || !health.loaded || health.model !== props.model_alias ||
      !Number.isInteger(context) || context < 1 || context !== props.default_generation_settings?.n_ctx ||
      !!health.images !== !!props.modalities?.vision) throw new Error('Strata capabilities changed or the model is not ready');
  const output = props.default_generation_settings?.params?.n_predict;
  const validOutput = Number.isInteger(output) && output > 0 && output + 4096 < context;
  const generation = { ...props.default_generation_settings?.params,
    max_tokens: validOutput ? output : null,
    reasoning_budget_tokens: defaults?.reasoning_budget_tokens ?? null,
    reasoning_effort: defaults?.reasoning_effort ?? null };
  delete generation.n_predict;
  const apiModel = defaults?.server_model === health.model && defaults?.api_model ? defaults.api_model : health.model;
  const identity = { model: apiModel, server_model: health.model, context_tokens: context, images: !!health.images, generation };
  return { schema_version: 1, fetched_at: new Date().toISOString(), service: 'strata', ready: true,
    fingerprint: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
    api_base_url: publicBase + '/v1', metrics_url: publicBase + '/metrics', terminal_client_url: publicBase + '/monitor-client.mjs', model: apiModel, server_model: health.model, context_tokens: context,
    input_modalities: health.images ? ['text', 'image'] : ['text'], output_modalities: ['text'],
    tool_calling: props.chat_template_caps?.supports_tools === true && props.chat_template_caps?.supports_tool_calls === true,
    parallel_tool_calls: props.chat_template_caps?.supports_parallel_tool_calls === true,
    generation_defaults: generation,
    defaults_source: defaults ? 'live_props_and_matching_launcher_shared_settings' : 'live_props_reasoning_unknown',
    total_slots: props.total_slots,
    pi_recommendation: validOutput ? { contextWindow: context, maxTokens: output,
      compaction: { reserveTokens: output + 4096, keepRecentTokens: Math.min(20000, Math.floor(context / 4)),
        triggerAboveTokens: context - output - 4096 },
      compatibility: { api: 'openai-completions', maxTokensField: 'max_tokens', supportsDeveloperRole: false,
        supportsStrictMode: false, supportsStore: false, thinkingFormat: 'chat-template' },
      request_defaults: defaults ? { reasoning_budget_tokens: defaults.reasoning_budget_tokens,
        reasoning_effort: defaults.reasoning_effort,
        chat_template_kwargs: { enable_thinking: defaults.reasoning_effort !== 'off' && defaults.reasoning_budget_tokens > 0,
          reasoning_effort: defaults.reasoning_effort, preserve_thinking: true } } : null } : null,
    verification: { source: ['GET /health', 'GET /props'], tools: 'advertised_by_server',
      streaming: 'bridge_transport_tested', generation_tested: false },
  };
}
