// Standalone WebGL probes import JSX without the application's index.html.
// Install Vite's React refresh preamble just as index.html normally does.
export const visualProbeHtml = (body) => `${body}<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => type => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>`;
