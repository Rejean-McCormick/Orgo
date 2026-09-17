import { useRouter } from "next/router";
import Head from "next/head";
import { OrgoApp } from "../src/orgo/OrgoApp";
export default function Page() {
  const router = useRouter();
  return (
    <>
      <Head>
        <title>Orgo · Organize and Go</title>
        <link rel="icon" href="/logo_k.svg" type="image/svg+xml" />
        <meta
          name="description"
          content="Organize signals into Workrooms, decisions, plans, Actions, evidence, and verified outcomes."
        />
      </Head>
      <OrgoApp
        path={(router.query.path as string[] | undefined) ?? []}
        navigate={(path) => {
          void router.push(`/${path}`);
        }}
      />
    </>
  );
}
