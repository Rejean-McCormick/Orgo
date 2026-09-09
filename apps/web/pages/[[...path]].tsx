import { useRouter } from "next/router";
import Head from "next/head";
import { OrgoApp } from "../src/orgo/OrgoApp";
export default function Page() {
  const router = useRouter();
  return (
    <>
      <Head>
        <title>Orgo · Travail opérationnel</title>
        <meta
          name="description"
          content="Signaux, dossiers et tâches dans un espace opérationnel commun."
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
