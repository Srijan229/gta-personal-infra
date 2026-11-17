# Initial decisions

- Use a separate private infrastructure repository; upstream remains the app source.
- Start locally on native Windows Node/PostgreSQL without Docker Desktop.
- Pin the source by commit so an upstream change cannot silently become a deployment.
- Create a dedicated empty `gta_personal` database.
- Use local ports 3101/8088 and loopback binding.
- Serve the built frontend through one gateway with API and auth forwarding.
- Clear inherited SSO, Power Automate and Basic Auth settings in worker processes.
- Keep source checkout, credentials, backups and logs out of Git.
- Choose cloud resources after selecting hosting and budget.

Source: upstream deployment, architecture and runtime files reviewed November 17,
2026. Machine-specific values belong only in `.env`.
