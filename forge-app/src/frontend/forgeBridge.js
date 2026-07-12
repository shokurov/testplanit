import { invoke, router } from '@forge/bridge';

export const createForgeBridge = () => ({
  getTestInfo: () => invoke('getTestInfo'),

  openUrl: async (url) => {
    try {
      await router.open(url);
      return;
    } catch (routerError) {
      console.log('Forge router.open() failed, trying router.navigate():', routerError);
      try {
        await router.navigate(url);
        return;
      } catch (navigateError) {
        console.log('Forge router.navigate() failed:', navigateError);
      }
    }
    window.location.href = url;
  },

  // The Forge resolver derives the issue from its own invocation context.
  getIssueContext: () => ({ issueKey: null, issueId: null }),

  getTheme: () =>
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
});
