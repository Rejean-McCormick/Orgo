# Validation records

`completion/` records current static checks only. `previous-delivery/` contains the previous version’s unit/integration/build logs; they do not validate the completion changes. Run `npm run validate:local` with `TEST_DATABASE_URL` to produce a new local result directory.
