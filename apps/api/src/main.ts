import { createApp } from './bootstrap';
async function main() {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0');
  console.log(
    JSON.stringify({
      event: 'orgo.api.ready',
      port: Number(process.env.PORT ?? 4000),
    }),
  );
}
main().catch(() => {
  console.error('Orgo API startup failed');
  process.exitCode = 1;
});
