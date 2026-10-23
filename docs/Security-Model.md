# Security Model

Security is designed into the first vertical slice.

## Identity and access
- Supabase Auth is the default identity provider.
- Backend validates authentication and authorization.
- RLS protects exposed client-owned tables.
- Browser roles get minimum database privileges.
- Service-role/admin credentials are server-side only.
- Agents/tools receive minimum permissions required.

## Agent boundaries
- Treat websites, documents, email, MCP/tool output and peer-agent output as untrusted data.
- Sandboxed execution is required when agent-controlled code/file execution would otherwise expose the host or broad credentials.
- A sandbox is a trust boundary, not permission to expose everything: mount only required files, tools, packages, network destinations and secrets.
- Development agents do not receive unrestricted production write access.
- Prefer read-only production access for diagnosis.
- Downstream systems enforce authorization; never rely on the model to decide whether an action is allowed.
- Minimise tool functionality as well as OAuth/API permissions.
- RED actions require explicit human approval or deterministic authorisation.
- BLACK actions are prohibited: self-granting permissions, revealing credentials, disabling logging, bypassing controls.

## Managed agent environments
If using Agents API or another managed harness:
- document whether execution is OpenAI-hosted, third-party sandbox or own infrastructure;
- classify what data/files/secrets enter that environment;
- scope network and tool access to the minimum required;
- keep durable permissions, audit records and consequential state outside model context;
- set explicit runtime/tool/spend limits and a cancellation/rollback path.

## Secrets
- Secrets never enter GitHub, client bundles, prompts, memory or knowledge.
- Use managed environment variables/vaults.
- Never log raw secrets or sensitive tokens.

## Client data
Follow `docs/Client-Data-Privacy.md` for minimisation, tenant isolation, dev/prod separation, external disclosure, retention and incident handling.

## Checklist
- [ ] Login/logout works
- [ ] Unauthorized API access rejected
- [ ] RLS allow tests pass
- [ ] RLS deny/cross-tenant tests pass
- [ ] Anonymous privileges reviewed
- [ ] Service role is server-side only
- [ ] No secrets in source, prompts or logs
- [ ] Prompt-injection scenario passes
- [ ] Tool functionality and permissions are minimum necessary
- [ ] Sandbox data/files/network/secrets are scoped
- [ ] RED/BLACK action controls verified
- [ ] Production write access for dev agents restricted
