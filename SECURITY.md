# Security Policy

## Purpose

This Security Policy establishes guidelines and requirements for protecting the confidentiality, integrity, and availability of the work-log project, its source code, infrastructure, and any data it handles. It applies to all contributors, maintainers, and users of this repository.

## Scope

This policy applies to:
- All source code and configuration files in this repository
- Build, deployment, and CI/CD pipelines
- Dependencies and third-party libraries
- Anyone with read, write, or administrative access to the repository

## Supported Versions

Only the latest minor release on the `main` branch receives active security updates. Older versions may not receive patches; users are encouraged to upgrade promptly when security releases are published.

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| older   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue, discussion, or pull request that discloses the vulnerability.
2. Report the issue privately by using GitHub's "Report a vulnerability" feature under the repository's Security tab, or by contacting the maintainer directly.
3. Include the following details where possible:
   - A clear description of the vulnerability and its potential impact
   - Steps to reproduce, including any required configuration or proof-of-concept code
   - The affected version, commit hash, or environment
   - Any suggested mitigation or fix

You can expect:
- An acknowledgement of your report within 5 business days
- A status update within 10 business days
- Coordinated disclosure once a fix is available, with credit given to the reporter unless anonymity is requested

## Responsible Disclosure

We ask that researchers:
- Make a good-faith effort to avoid privacy violations, data destruction, and service disruption
- Do not exploit the vulnerability beyond what is necessary to demonstrate it
- Give us a reasonable amount of time to address the issue before public disclosure (typically 90 days)

## Secure Development Practices

Contributors are expected to follow these practices:

### Code
- Validate and sanitize all external input
- Use parameterized queries to prevent injection attacks
- Apply the principle of least privilege to processes, files, and credentials
- Avoid hardcoding secrets, API keys, tokens, or passwords in source code or commit history
- Prefer well-maintained, audited libraries over custom cryptography

### Dependencies
- Keep dependencies up to date and review Dependabot or equivalent alerts promptly
- Pin dependency versions where reproducibility matters
- Review new dependencies for license, maintenance status, and known CVEs before adoption

### Authentication and Access
- Use strong, unique passwords and enable two-factor authentication on GitHub accounts
- Rotate personal access tokens and deploy keys regularly
- Limit repository write and admin permissions to those who require them
- Sign commits and tags with GPG or SSH signatures where feasible

### Secrets Management
- Store secrets in GitHub Actions secrets, environment variables, or a dedicated secrets manager
- Never commit `.env` files, private keys, or credentials to the repository
- If a secret is accidentally committed, rotate it immediately and follow the incident response procedure below

## Branch and Repository Protection

- The `main` branch is protected and requires pull request review before merging
- Force pushes to protected branches are disallowed
- Status checks (CI, tests, linting) must pass before merging
- Administrative actions on the repository require explicit maintainer approval

## Incident Response

In the event of a confirmed security incident:

1. **Contain** - revoke compromised credentials, disable affected accounts, and isolate impacted systems
2. **Assess** - determine scope, affected data, and root cause
3. **Remediate** - patch the vulnerability, rotate secrets, and verify the fix in a non-production environment
4. **Communicate** - notify affected users and publish a security advisory once a fix is available
5. **Review** - conduct a post-incident review and update this policy and related controls as needed

## Logging and Monitoring

- Sensitive actions on the repository (permission changes, secret access, releases) should be reviewed periodically through GitHub's audit log
- CI/CD logs must not include secrets or personally identifiable information
- Anomalies should be investigated promptly

## Data Handling

- Do not store production or personally identifiable data in the repository, issues, or pull requests
- Use anonymized or synthetic data for examples, tests, and documentation
- Comply with applicable data protection regulations (e.g., GDPR, CCPA) when handling user data in any deployment of this project

## Policy Review

This policy is reviewed at least annually and updated as the project evolves or in response to significant security events. Suggestions for improvement are welcome via pull request.

## Acknowledgements

We thank the security community and individual researchers who responsibly disclose vulnerabilities and help keep this project secure.
