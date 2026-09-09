import Head from "next/head";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { OrgoClient } from "../src/orgo/api";
export default function Account() {
  const [token, setToken] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get(
      "token",
    );
    if (value) {
      setToken(value);
      history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(e.currentTarget);
    try {
      const client = new OrgoClient();
      if (token) {
        if (form.get("password") !== form.get("confirm"))
          throw new Error("Les mots de passe ne correspondent pas.");
        await client.request("auth/reset", "POST", {
          token,
          password: form.get("password"),
        });
        setToken("");
        setMessage("Mot de passe enregistré. Vous pouvez vous connecter.");
      } else {
        await client.request("auth/recover", "POST", {
          organization: form.get("organization"),
          email: form.get("email"),
        });
        setMessage(
          "Si le compte est admissible, un lien sera envoyé par courriel.",
        );
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-page">
      <Head>
        <title>Accès Orgo</title>
        <meta name="referrer" content="no-referrer" />
      </Head>
      <section className="panel form-panel">
        <h1>
          {token ? "Définir votre mot de passe" : "Retrouver votre accès"}
        </h1>
        <form onSubmit={submit}>
          {token ? (
            <>
              <label>
                Nouveau mot de passe
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={200}
                  required
                />
              </label>
              <label>
                Confirmer
                <input
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Organisation
                <input name="organization" required maxLength={100} />
              </label>
              <label>
                Courriel
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </label>
            </>
          )}
          <button className="primary" disabled={busy}>
            {token ? "Enregistrer" : "Envoyer le lien"}
          </button>
        </form>
        <p role="status">{message}</p>
        <Link href="/">Revenir à Orgo</Link>
      </section>
    </main>
  );
}
