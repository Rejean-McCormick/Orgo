# Compose dynamic host ports

Orgo's Docker Compose file now keeps its normal host-port defaults while allowing isolated runs to override them:

- `ORGO_API_HOST_PORT` defaults to `4000`.
- `ORGO_WEB_HOST_PORT` defaults to `3000`.

Container ports remain unchanged (`4000` for API and `3000` for web). This lets LevelUpDiag N14 allocate free loopback host ports without killing or replacing another local Orgo instance.
