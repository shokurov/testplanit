import React, { createContext, useContext } from 'react';

// Host-platform seam. Forge implements this with @forge/bridge, the Jira DC
// plugin with fetch against its own REST module. The shared components only
// ever see this object.
export const PanelBridgeContext = createContext(null);

export const PanelBridgeProvider = ({ bridge, children }) => (
  <PanelBridgeContext.Provider value={bridge}>{children}</PanelBridgeContext.Provider>
);

export const usePanelBridge = () => {
  const bridge = useContext(PanelBridgeContext);
  if (!bridge) {
    throw new Error('PanelBridgeProvider is missing');
  }
  return bridge;
};
