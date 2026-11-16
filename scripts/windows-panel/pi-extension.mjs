import {readPi, payload, write, getJson} from './core.mjs';

export default function (pi) {
  const m = readPi(process.env.LOCAL_LLAMA_PANEL_PI);
  pi.registerProvider('local-llamacpp', {
    name: 'Local Strata', baseUrl: `http://127.0.0.1:${m.expected.port}/v1`, apiKey: 'local-no-key', api: 'openai-completions',
    models: [{type: 'chat', id: m.model, name: m.expected.model, reasoning: true,
      input: m.expected.vision ? ['text', 'image'] : ['text'],
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: m.expected.context, maxTokens: m.output,
      compat: {maxTokensField: 'max_tokens', supportsStrictMode: false, supportsStore: false,
        supportsDeveloperRole: false, thinkingFormat: 'chat-template', chatTemplateKwargs: {
        enable_thinking: {$var: 'thinking.enabled'}, reasoning_effort: {$var: 'thinking.effort'}, preserve_thinking: true,
      }}}],
  });
  pi.on('before_provider_request', async (event, ctx) => {
    if (ctx && (ctx.model?.provider !== 'local-llamacpp' || ctx.model?.id !== m.model)) {
      throw new Error('This Pi is pinned to the local server selected in Strata Launcher. Reconfigure from the panel.');
    }
    const h = await getJson(m.expected.port, 'health');
    if (!h.loaded || h.model !== m.expected.model || h.max_context !== m.expected.context || !!h.images !== m.expected.vision) {
      throw new Error('Strata capabilities changed. Reconfigure Pi from the launcher.');
    }
    if (m.expected.apiModel) {
      const models = await getJson(m.expected.port, 'v1/models');
      if (!models.data?.some(model => model.id === m.expected.apiModel && model.alias_of === h.model)) {
        throw new Error('Strata run alias changed. Reconfigure Pi from the launcher.');
      }
    }
    return payload(m, event.payload);
  });
  pi.on('session_start', (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    write(m.indexFile, {fingerprint: m.fingerprint, sessionId, sessionFile: ctx.sessionManager.getSessionFile(),
      cwd: m.cwd, model: m.model, updated: new Date().toISOString()});
    if (!m.footer && ctx.mode === 'tui') ctx.ui.setFooter(() => ({render: () => [], invalidate() {}}));
    if (ctx.mode === 'tui') ctx.ui.setStatus('strata-panel', `${m.expected.vision ? 'Vision' : 'Text'} ${m.expected.context} | out ${m.output} think ${m.thinking}`);
  });
}
