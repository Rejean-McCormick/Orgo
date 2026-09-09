// apps/web/pages/index.tsx

import type { NextPage } from "next";
import InsightsOverviewPage from "../src/screens/insights/InsightsOverviewPage";

/**
 * Orgo web entrypoint.
 * Routes the root path ("/") into the Insights overview dashboard.
 */
const IndexPage: NextPage = () => {
  return <InsightsOverviewPage />;
};

export default IndexPage;
