// apps/web/pages/_app.tsx

import "./styles.css";

import type { AppProps } from "next/app";
import type { NextPage } from "next";
import Head from "next/head";
import type { ReactElement, ReactNode } from "react";

import { AppProviders } from "../src/providers/AppProviders";

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: ReactElement) => ReactNode;
};

export type AppPropsWithLayout<P = any> = AppProps<P> & {
  Component: NextPageWithLayout<P>;
};

function OrgoApp({ Component, pageProps }: AppPropsWithLayout) {
  const getLayout =
    Component.getLayout ??
    ((page: ReactElement) => page);

  const page = getLayout(<Component {...pageProps} />);

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Orgo</title>
      </Head>
      {/* AppProviders no longer expects pageProps */}
      <AppProviders>{page}</AppProviders>
    </>
  );
}

export default OrgoApp;
