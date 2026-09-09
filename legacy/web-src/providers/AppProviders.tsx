// apps/web/src/providers/AppProviders.tsx

import type { ReactNode } from "react";
import { Provider as ReduxProvider } from "react-redux";

import store from "../store";

export interface AppProvidersProps {
  children: ReactNode;
}

/**
 * Root application providers for Orgo web.
 * Currently just Redux; extend with theme/query/etc. here.
 */
export function AppProviders({ children }: AppProvidersProps) {
  return <ReduxProvider store={store}>{children}</ReduxProvider>;
}

export default AppProviders;
