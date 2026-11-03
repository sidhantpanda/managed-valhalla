# Security

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository (**Security** tab → **Report a vulnerability**). Please don't open a public issue.

Include what you found, how to reproduce it, and its impact. You should get a reply within a week.

## Deployment model

valhalla-manager is meant to run on a private network. Know these before exposing it:

- **The admin (port 8003) has no authentication.** Anyone who can reach it can add regions, start and cancel builds, and make the server download large files. Never expose it to the internet. If you need remote access, put it behind a VPN or a reverse proxy that requires a login.
- **The Valhalla API (port 8002) has no authentication or rate limiting.** If you expose it publicly, put a reverse proxy in front of it that adds both, since route requests can be CPU-heavy.

Reports about the admin lacking authentication are expected behaviour, not vulnerabilities. Reports about ways to escape these boundaries (for example, writing outside the data folder or running commands through region ids) are very welcome.
