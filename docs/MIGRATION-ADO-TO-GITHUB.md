# ADO Pipelines → GitHub Actions: Migration Runbook

> **Source**: Azure DevOps org `sid-msft`, project `test-project`
> **Target**: GitHub org `sidlabs-platform`, repo `test-project`
> **Date**: 2026-05-17

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Phase 1 — Install & Configure gh-actions-importer](#2-phase-1--install--configure-gh-actions-importer)
3. [Phase 2 — Audit ADO Pipelines](#3-phase-2--audit-ado-pipelines)
4. [Phase 3 — Dry-Run Conversion](#4-phase-3--dry-run-conversion)
5. [Phase 4 — Migrate (Generate Workflow Files)](#5-phase-4--migrate-generate-workflow-files)
6. [Phase 5 — Push Code to GitHub](#6-phase-5--push-code-to-github)
7. [Phase 6 — Post-Migration Configuration](#7-phase-6--post-migration-configuration)
8. [Phase 7 — Validate & Verify](#8-phase-7--validate--verify)
9. [Phase 8 — Decommission ADO Pipelines](#9-phase-8--decommission-ado-pipelines)
10. [Pipeline Mapping Reference](#10-pipeline-mapping-reference)
11. [Concept Mapping: ADO → GitHub Actions](#11-concept-mapping-ado--github-actions)
12. [Automation Script](#12-automation-script)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Prerequisites

### 1.1 Tools Required

| Tool | Version | Install Command | Purpose |
|------|---------|-----------------|---------|
| **gh CLI** | ≥ 2.40 | `winget install GitHub.cli` | GitHub CLI |
| **Docker Desktop** | ≥ 4.x | `winget install Docker.DockerDesktop` | Required by actions-importer |
| **Git** | ≥ 2.40 | `winget install Git.Git` | Version control |
| **Node.js** | 20.x LTS | `winget install OpenJS.NodeJS.LTS` | Project runtime |

### 1.2 Tokens Required

| Token | Scopes | Where to Create |
|-------|--------|-----------------|
| **GitHub PAT** | `repo`, `workflow`, `admin:org` | `https://github.com/settings/tokens` |
| **Azure DevOps PAT** | `Build (Read)`, `Code (Read)`, `Release (Read)`, `Project and Team (Read)` | `https://dev.azure.com/sid-msft/_usersSettings/tokens` |

### 1.3 Verify Prerequisites

```bash
# Verify gh CLI
gh --version
# Expected: gh version 2.x.x

# Verify Docker
docker --version
# Expected: Docker version 2x.x.x

# Verify Git
git --version

# Verify GitHub authentication
gh auth status
# Expected: ✓ Logged in to github.com

# Verify Docker is running
docker info > /dev/null 2>&1 && echo "Docker is running" || echo "Docker is NOT running"
```

---

## 2. Phase 1 — Install & Configure gh-actions-importer

### 2.1 Install the Extension

```bash
gh extension install github/gh-actions-importer
```

> **SAML Note**: If you get `HTTP 403: Resource protected by organization SAML enforcement`,
> authorize your token for the `github` org at the URL shown in the error, then retry.

### 2.2 Verify Installation

```bash
gh actions-importer version
```

### 2.3 Update the Extension (if already installed)

```bash
gh actions-importer update
```

### 2.4 Configure Credentials

```bash
gh actions-importer configure
```

This interactive command will prompt for:

| Prompt | Value | Description |
|--------|-------|-------------|
| CI provider | `azure_devops` | Source platform |
| GitHub PAT | `ghp_xxxx` | Token with `repo`, `workflow` scopes |
| GitHub URL | `https://github.com` | GitHub instance URL |
| Azure DevOps PAT | `ado_pat_xxxx` | Token with Build/Code/Release read |
| Azure DevOps URL | `https://dev.azure.com/sid-msft` | ADO organization URL |

The credentials are saved to `~/.env.local` (or `%USERPROFILE%\.env.local` on Windows).

### 2.5 Alternative: Environment Variables

```bash
# Instead of interactive configure, export directly:
export GITHUB_ACCESS_TOKEN="ghp_xxxxxxxxxxxx"
export GITHUB_INSTANCE_URL="https://github.com"
export AZURE_DEVOPS_ACCESS_TOKEN="ado_pat_xxxxxxxxxxxx"
export AZURE_DEVOPS_ORGANIZATION="https://dev.azure.com/sid-msft"
export AZURE_DEVOPS_PROJECT="test-project"
```

---

## 3. Phase 2 — Audit ADO Pipelines

The audit step inventories all pipelines in the ADO project and produces a summary
of what can/cannot be automatically converted.

### 3.1 Run Audit

```bash
gh actions-importer audit azure-devops \
  --output-dir audit-output \
  --azure-devops-organization "https://dev.azure.com/sid-msft" \
  --azure-devops-project "test-project"
```

### 3.2 Review Audit Output

```bash
# The audit creates these files:
# audit-output/
# ├── audit_summary.md        ← High-level conversion readiness
# ├── pipelines/              ← Individual pipeline reports
# └── manifest.json           ← Machine-readable inventory

cat audit-output/audit_summary.md
```

### 3.3 What the Audit Tells You

| Section | What It Shows |
|---------|---------------|
| **Pipelines** | Total count, types (YAML, Classic, Release) |
| **Build steps** | Which ADO tasks map to GitHub Actions |
| **Manual tasks** | Steps that require manual conversion |
| **Secrets/Variables** | Variable groups and secrets that need recreation |
| **Service connections** | Azure service connections to recreate |
| **Environments** | ADO environments to recreate as GitHub environments |

---

## 4. Phase 3 — Dry-Run Conversion

Dry-run produces the converted workflow YAML **without** creating a PR or pushing code.
Use this to review and validate before actual migration.

### 4.1 Dry-Run Each Pipeline

```bash
# Main CI pipeline
gh actions-importer dry-run azure-devops pipeline \
  --output-dir dry-run-output \
  --azure-devops-organization "https://dev.azure.com/sid-msft" \
  --azure-devops-project "test-project" \
  --pipeline-id <PIPELINE_ID_FOR_CI>

# PR validation pipeline
gh actions-importer dry-run azure-devops pipeline \
  --output-dir dry-run-output \
  --azure-devops-organization "https://dev.azure.com/sid-msft" \
  --azure-devops-project "test-project" \
  --pipeline-id <PIPELINE_ID_FOR_PR>

# CD deploy pipeline
gh actions-importer dry-run azure-devops pipeline \
  --output-dir dry-run-output \
  --azure-devops-organization "https://dev.azure.com/sid-msft" \
  --azure-devops-project "test-project" \
  --pipeline-id <PIPELINE_ID_FOR_CD>
```

> **Finding Pipeline IDs**: Go to `https://dev.azure.com/sid-msft/test-project/_build`
> → click each pipeline → the URL contains `definitionId=<ID>`.

### 4.2 Review Dry-Run Output

```bash
# Each pipeline produces a converted workflow:
# dry-run-output/
# ├── <pipeline-name>/
# │   ├── .github/workflows/<name>.yml   ← Converted workflow
# │   └── README.md                       ← Conversion notes & warnings

# Review the converted YAML
cat dry-run-output/*/github/workflows/*.yml
```

### 4.3 Identify Manual Fixes

Look for these common items in the dry-run output:

| ADO Feature | Requires Manual Fix? | GitHub Equivalent |
|-------------|---------------------|-------------------|
| `task: NodeTool@0` | ✅ Auto-converted | `actions/setup-node@v4` |
| `task: Cache@2` | ✅ Auto-converted | `actions/cache@v4` (or `setup-node` built-in cache) |
| `task: PublishTestResults@2` | ⚠️ Partial | `dorny/test-reporter@v1` or `actions/upload-artifact` |
| `task: PublishCodeCoverageResults@2` | ⚠️ Partial | `actions/upload-artifact` |
| `task: AzureWebApp@1` | ⚠️ Manual | `azure/webapps-deploy@v3` |
| `task: PublishBuildArtifacts@1` | ✅ Auto-converted | `actions/upload-artifact@v4` |
| Variable groups | ❌ Manual | GitHub Secrets + Variables |
| Service connections | ❌ Manual | OIDC / Secrets |
| Environments with approvals | ❌ Manual | GitHub Environments with protection rules |
| Template references | ⚠️ Partial | Composite actions or reusable workflows |
| `deployment` job type | ⚠️ Partial | `environment:` key on jobs |

---

## 5. Phase 4 — Migrate (Generate Workflow Files)

### 5.1 Option A: Auto-Migrate via PR

```bash
# Creates a PR on the target GitHub repo with converted workflows
gh actions-importer migrate azure-devops pipeline \
  --target-url "https://github.com/sidlabs-platform/test-project" \
  --output-dir migrate-output \
  --azure-devops-organization "https://dev.azure.com/sid-msft" \
  --azure-devops-project "test-project" \
  --pipeline-id <PIPELINE_ID>
```

This will:
1. Convert the ADO pipeline YAML to GitHub Actions YAML
2. Create a pull request on `sidlabs-platform/test-project` with the new workflow

### 5.2 Option B: Manual Conversion (Used in This Migration)

Since the `gh-actions-importer` may not handle all ADO features perfectly,
we manually created equivalent GitHub Actions workflows:

| ADO Pipeline File | GitHub Actions Workflow | Description |
|-------------------|------------------------|-------------|
| `azure-pipelines.yml` | `.github/workflows/ci.yml` | CI — build, lint, test, security scan |
| `pipelines/pr-validation.yml` | `.github/workflows/pr-validation.yml` | PR gate — lint + test |
| `pipelines/cd-deploy.yml` | `.github/workflows/cd-deploy.yml` | CD — Dev → Staging → Production |
| `pipelines/templates/setup-node.yml` | Inlined in each workflow | `actions/setup-node@v4` |
| `pipelines/templates/install-deps.yml` | Inlined in each workflow | `npm ci` with built-in cache |
| `pipelines/templates/deploy-webapp.yml` | Inlined in `cd-deploy.yml` | `azure/webapps-deploy@v3` |
| `pipelines/templates/smoke-test.yml` | Inlined in `cd-deploy.yml` | `curl` health/API checks |

### 5.3 Workflow Files Created

```
.github/
└── workflows/
    ├── ci.yml              # CI pipeline (push to main)
    ├── pr-validation.yml   # PR validation (pull_request to main)
    └── cd-deploy.yml       # CD pipeline (after CI succeeds)
```

---

## 6. Phase 5 — Push Code to GitHub

### 6.1 Add GitHub Remote

```bash
cd c:\temp\test-ADO

# Add GitHub as a new remote (keep ADO as 'origin' temporarily)
git remote rename origin ado
git remote add origin https://github.com/sidlabs-platform/test-project.git
```

### 6.2 Stage and Commit GitHub Actions Workflows

```bash
git add .github/workflows/
git add docs/   # Migration documentation if present
git commit -m "ci: add GitHub Actions workflows (migrated from ADO pipelines)

Converted pipelines:
- azure-pipelines.yml → .github/workflows/ci.yml
- pipelines/pr-validation.yml → .github/workflows/pr-validation.yml
- pipelines/cd-deploy.yml → .github/workflows/cd-deploy.yml
- ADO templates inlined into workflow files"
```

### 6.3 Push to GitHub

```bash
# Push main branch to GitHub
git push -u origin main

# Verify push
gh repo view sidlabs-platform/test-project --web
```

### 6.4 (Optional) Mirror All Branches and Tags

```bash
# Push all branches
git push origin --all

# Push all tags
git push origin --tags
```

---

## 7. Phase 6 — Post-Migration Configuration

### 7.1 Create GitHub Environments

```bash
# GitHub environments replace ADO environments for deployment approvals
# Must be done via GitHub UI or API — gh CLI doesn't support environment creation directly

# Via API:
gh api repos/sidlabs-platform/test-project/environments/dev --method PUT
gh api repos/sidlabs-platform/test-project/environments/staging --method PUT
gh api repos/sidlabs-platform/test-project/environments/production --method PUT
```

### 7.2 Add Environment Protection Rules

```bash
# Add required reviewers to staging
gh api repos/sidlabs-platform/test-project/environments/staging \
  --method PUT \
  --field 'reviewers[][type]=User' \
  --field 'reviewers[][id]=<YOUR_USER_ID>'

# Add required reviewers to production
gh api repos/sidlabs-platform/test-project/environments/production \
  --method PUT \
  --field 'reviewers[][type]=User' \
  --field 'reviewers[][id]=<YOUR_USER_ID>'
```

> Get your user ID: `gh api user --jq '.id'`

### 7.3 Create Repository Secrets

ADO variable groups → GitHub repository secrets:

```bash
# Azure deployment secrets (for CD pipeline)
gh secret set AZURE_CLIENT_ID --repo sidlabs-platform/test-project
gh secret set AZURE_TENANT_ID --repo sidlabs-platform/test-project
gh secret set AZURE_SUBSCRIPTION_ID --repo sidlabs-platform/test-project
```

> Each command will prompt for the secret value interactively.

### 7.4 Create Repository Variables (non-sensitive)

```bash
gh variable set NODE_VERSION --body "20.x" --repo sidlabs-platform/test-project
gh variable set APP_NAME --body "task-board-webapp" --repo sidlabs-platform/test-project
```

### 7.5 Configure Branch Protection

```bash
gh api repos/sidlabs-platform/test-project/branches/main/protection \
  --method PUT \
  --input - <<EOF
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["✅ PR Validation"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1
  },
  "restrictions": null
}
EOF
```

### 7.6 Set Up Azure OIDC Federation (Replaces Service Connections)

ADO uses service connections; GitHub uses OIDC federated credentials.

```bash
# 1. Create an Azure AD App Registration (if not exists)
az ad app create --display-name "github-actions-test-project"

# 2. Create federated credential for each environment
az ad app federated-credential create \
  --id <APP_OBJECT_ID> \
  --parameters '{
    "name": "github-actions-dev",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:sidlabs-platform/test-project:environment:dev",
    "audiences": ["api://AzureADTokenExchange"]
  }'

az ad app federated-credential create \
  --id <APP_OBJECT_ID> \
  --parameters '{
    "name": "github-actions-staging",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:sidlabs-platform/test-project:environment:staging",
    "audiences": ["api://AzureADTokenExchange"]
  }'

az ad app federated-credential create \
  --id <APP_OBJECT_ID> \
  --parameters '{
    "name": "github-actions-production",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:sidlabs-platform/test-project:environment:production",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

---

## 8. Phase 7 — Validate & Verify

### 8.1 Verify CI Workflow

```bash
# Trigger a CI run by pushing a small change
echo "# Migrated to GitHub" >> README.md
git add README.md
git commit -m "docs: trigger CI after migration"
git push origin main

# Check workflow run
gh run list --repo sidlabs-platform/test-project --limit 5
gh run view <RUN_ID> --repo sidlabs-platform/test-project
```

### 8.2 Verify PR Validation

```bash
# Create a test branch and PR
git checkout -b test/migration-verify
echo "test" > migration-test.txt
git add migration-test.txt
git commit -m "test: verify PR validation workflow"
git push origin test/migration-verify

gh pr create \
  --repo sidlabs-platform/test-project \
  --title "test: verify PR validation" \
  --body "Testing PR validation workflow after ADO migration" \
  --base main \
  --head test/migration-verify

# Watch the PR checks
gh pr checks <PR_NUMBER> --repo sidlabs-platform/test-project
```

### 8.3 Verify CD Workflow

```bash
# CD triggers automatically after CI succeeds on main
# Monitor it:
gh run list --repo sidlabs-platform/test-project --workflow "CD - Deploy" --limit 5
```

### 8.4 Compare Pipeline Outputs

| Check | ADO | GitHub Actions |
|-------|-----|----------------|
| CI triggers on push to main | ✅ | ✅ Verify with `gh run list` |
| PR validation runs on PR | ✅ | ✅ Verify with `gh pr checks` |
| Tests pass | ✅ 11/11 | ✅ Check annotations |
| Lint passes | ✅ | ✅ Check step output |
| Artifacts published | ✅ `drop` | ✅ Check Actions artifacts tab |
| Coverage uploaded | ✅ | ✅ Check artifacts |
| Security audit runs | ✅ | ✅ Check security-scan job |
| CD deploys to dev | ✅ | ✅ Check environment |
| CD requires approval for staging | ✅ | ✅ Check environment rules |
| CD requires approval for production | ✅ | ✅ Check environment rules |

---

## 9. Phase 8 — Decommission ADO Pipelines

> ⚠️ Only do this after GitHub Actions are fully verified.

### 9.1 Disable ADO Pipelines

```bash
# Via ADO UI: Pipeline → Settings → Paused/Disabled
# Or via REST API:
curl -X PATCH \
  "https://dev.azure.com/sid-msft/test-project/_apis/build/definitions/<DEFINITION_ID>?api-version=7.0" \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n :$ADO_PAT | base64)" \
  -d '{"queueStatus": "disabled"}'
```

### 9.2 Remove ADO Remote (Optional)

```bash
git remote remove ado
```

### 9.3 Archive ADO Pipeline Files (Optional)

```bash
# Move ADO-specific files to an archive folder or delete them
mkdir -p .archive/ado-pipelines
mv azure-pipelines.yml .archive/ado-pipelines/
mv pipelines/ .archive/ado-pipelines/
git add -A
git commit -m "chore: archive ADO pipeline files after GitHub Actions migration"
git push origin main
```

---

## 10. Pipeline Mapping Reference

### 10.1 File-Level Mapping

| ADO File | GitHub Actions File | Notes |
|----------|-------------------|-------|
| `azure-pipelines.yml` | `.github/workflows/ci.yml` | Main CI pipeline |
| `pipelines/pr-validation.yml` | `.github/workflows/pr-validation.yml` | PR gate |
| `pipelines/cd-deploy.yml` | `.github/workflows/cd-deploy.yml` | Multi-env CD |
| `pipelines/templates/setup-node.yml` | Inlined: `actions/setup-node@v4` | Setup step |
| `pipelines/templates/install-deps.yml` | Inlined: `npm ci` + `cache: 'npm'` | Install step |
| `pipelines/templates/deploy-webapp.yml` | Inlined: `azure/webapps-deploy@v3` | Deploy step |
| `pipelines/templates/smoke-test.yml` | Inlined: `curl` script step | Smoke test |

### 10.2 Task-Level Mapping

| ADO Task | GitHub Action | Version |
|----------|---------------|---------|
| `NodeTool@0` | `actions/setup-node@v4` | v4 |
| `Cache@2` | Built-in via `setup-node` `cache: 'npm'` | — |
| `PublishTestResults@2` (JUnit) | `dorny/test-reporter@v1` | v1 |
| `PublishCodeCoverageResults@2` | `actions/upload-artifact@v4` | v4 |
| `PublishBuildArtifacts@1` | `actions/upload-artifact@v4` | v4 |
| `CopyFiles@2` | Not needed (upload-artifact handles paths) | — |
| `AzureWebApp@1` | `azure/webapps-deploy@v3` | v3 |
| `script:` | `run:` | — |

---

## 11. Concept Mapping: ADO → GitHub Actions

| ADO Concept | GitHub Actions Equivalent | Notes |
|-------------|--------------------------|-------|
| `trigger:` | `on: push:` | Push triggers |
| `pr:` | `on: pull_request:` | PR triggers |
| `pool: vmImage` | `runs-on:` | Runner selection |
| `stages:` | `jobs:` (with `needs:`) | Stages become jobs with dependencies |
| `jobs:` | `jobs:` | Direct mapping |
| `steps:` | `steps:` | Direct mapping |
| `task: Name@Version` | `uses: owner/action@version` | Marketplace actions |
| `script:` | `run:` | Inline scripts |
| `displayName:` | `name:` | Step/job display names |
| `condition: succeeded()` | `if: success()` | Conditional execution |
| `condition: always()` | `if: always()` | Always run |
| `condition: failed()` | `if: failure()` | Run on failure |
| `condition: succeededOrFailed()` | `if: always()` | Closest equivalent |
| `continueOnError: true` | `continue-on-error: true` | Non-blocking steps |
| `variables:` | `env:` / Secrets / Variables | Environment/secrets |
| `- group: name` | Secrets / Variables | Variable groups → secrets |
| `template: path.yml` | `uses: ./.github/actions/x` or inline | Template reuse |
| `resources: pipelines:` | `on: workflow_run:` | Pipeline triggers |
| `deployment:` job | `jobs: X: environment:` | Environment deployments |
| `environment: 'name'` | `environment: name` | Deployment targets |
| `strategy: runOnce:` | Default (no strategy needed) | Deployment strategy |
| `postRouteTraffic:` | Additional steps after deploy | No direct equivalent |
| `retryCountOnTaskFailure: 2` | Loop in shell script | No native retry |
| `$(System.DefaultWorkingDirectory)` | `${{ github.workspace }}` | Workspace path |
| `$(Build.SourceBranch)` | `${{ github.ref }}` | Branch reference |
| `$(Build.BuildNumber)` | `${{ github.run_number }}` | Build number |
| `$(Pipeline.Workspace)` | `${{ runner.temp }}` | Temp workspace |
| `$(System.PullRequest.SourceBranch)` | `${{ github.head_ref }}` | PR source branch |
| Service connections | OIDC federated credentials | Azure auth |
| Variable groups | Repository secrets + variables | Secret management |
| Artifact staging | `actions/upload-artifact` | Artifact publishing |

---

## 12. Automation Script

Save this as `migrate.sh` to automate the full migration:

```bash
#!/usr/bin/env bash
set -euo pipefail

# ─── Configuration ─────────────────────────────────────────────────────
ADO_ORG="https://dev.azure.com/sid-msft"
ADO_PROJECT="test-project"
GH_ORG="sidlabs-platform"
GH_REPO="test-project"
REPO_DIR="c:/temp/test-ADO"

echo "=== ADO → GitHub Migration Script ==="

# ─── Step 1: Verify prerequisites ──────────────────────────────────────
echo "[1/9] Verifying prerequisites..."
command -v gh >/dev/null 2>&1 || { echo "ERROR: gh CLI not found"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "ERROR: git not found"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not found"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "ERROR: gh not authenticated"; exit 1; }
echo "  ✅ All prerequisites met"

# ─── Step 2: Install/update actions-importer ───────────────────────────
echo "[2/9] Installing gh-actions-importer..."
gh extension install github/gh-actions-importer 2>/dev/null || \
  gh actions-importer update
echo "  ✅ actions-importer ready"

# ─── Step 3: Create GitHub repo ────────────────────────────────────────
echo "[3/9] Creating GitHub repository..."
gh repo create "${GH_ORG}/${GH_REPO}" \
  --public \
  --description "Task Board demo - migrated from Azure DevOps" \
  2>/dev/null || echo "  ⚠️ Repo already exists, continuing..."
echo "  ✅ GitHub repo ready"

# ─── Step 4: Audit ADO pipelines ──────────────────────────────────────
echo "[4/9] Auditing ADO pipelines..."
gh actions-importer audit azure-devops \
  --output-dir "${REPO_DIR}/audit-output" \
  --azure-devops-organization "${ADO_ORG}" \
  --azure-devops-project "${ADO_PROJECT}"
echo "  ✅ Audit complete — review audit-output/audit_summary.md"

# ─── Step 5: Dry-run conversion ───────────────────────────────────────
echo "[5/9] Running dry-run conversion..."
gh actions-importer dry-run azure-devops \
  --output-dir "${REPO_DIR}/dry-run-output" \
  --azure-devops-organization "${ADO_ORG}" \
  --azure-devops-project "${ADO_PROJECT}"
echo "  ✅ Dry-run complete — review dry-run-output/"

# ─── Step 6: Configure git remotes ────────────────────────────────────
echo "[6/9] Configuring git remotes..."
cd "${REPO_DIR}"
git remote rename origin ado 2>/dev/null || true
git remote add origin "https://github.com/${GH_ORG}/${GH_REPO}.git" 2>/dev/null || \
  git remote set-url origin "https://github.com/${GH_ORG}/${GH_REPO}.git"
echo "  ✅ Remotes configured (ado=ADO, origin=GitHub)"

# ─── Step 7: Stage and commit workflows ───────────────────────────────
echo "[7/9] Committing GitHub Actions workflows..."
git add .github/workflows/ docs/ 2>/dev/null || true
git diff --cached --quiet || \
  git commit -m "ci: add GitHub Actions workflows (migrated from ADO pipelines)"
echo "  ✅ Workflows committed"

# ─── Step 8: Push to GitHub ───────────────────────────────────────────
echo "[8/9] Pushing to GitHub..."
git push -u origin main
echo "  ✅ Code pushed to GitHub"

# ─── Step 9: Post-migration setup ────────────────────────────────────
echo "[9/9] Setting up GitHub environments and secrets..."
gh api "repos/${GH_ORG}/${GH_REPO}/environments/dev" --method PUT --silent
gh api "repos/${GH_ORG}/${GH_REPO}/environments/staging" --method PUT --silent
gh api "repos/${GH_ORG}/${GH_REPO}/environments/production" --method PUT --silent
echo "  ✅ Environments created"

echo ""
echo "=== Migration Complete ==="
echo "  ADO:    ${ADO_ORG}/${ADO_PROJECT}"
echo "  GitHub: https://github.com/${GH_ORG}/${GH_REPO}"
echo ""
echo "Next steps:"
echo "  1. Set secrets:  gh secret set AZURE_CLIENT_ID --repo ${GH_ORG}/${GH_REPO}"
echo "  2. Verify CI:    gh run list --repo ${GH_ORG}/${GH_REPO}"
echo "  3. Disable ADO:  Pause pipelines in ADO UI"
```

---

## 13. Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `HTTP 403: SAML enforcement` on extension install | Token not authorized for `github` org SSO | Click the SSO authorization URL in the error message |
| `actions-importer: Docker not running` | Docker Desktop not started | Start Docker Desktop, verify with `docker info` |
| `Cannot resolve action azure/login@v2` | Local linter warning only | Safe to ignore — resolves at runtime on GitHub |
| `workflow_run` CD not triggering | Workflow files must be on default branch | Merge workflows to `main` first, then push a CI-triggering commit |
| `Download artifact` fails in CD | `workflow_run` artifacts need explicit `run-id` | Use `github.event.workflow_run.id` as shown in cd-deploy.yml |
| Branch protection blocks push | Rules require PR | Temporarily disable protection, push, then re-enable |
| OIDC login fails | Federated credential `subject` mismatch | Ensure subject matches `repo:org/repo:environment:name` exactly |
| ADO templates not converted | `gh-actions-importer` has partial template support | Inline template content into workflow files manually |
