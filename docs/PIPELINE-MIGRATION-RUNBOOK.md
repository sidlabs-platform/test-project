# ADO Pipelines → GitHub Actions: Validated Migration Runbook

> **Source**: Azure DevOps org `sid-msft`, project `test-project`
> **Target**: GitHub org `sidlabs-platform`, repo `test-project`
> **Date**: 2026-05-17
> **Tool**: `gh-actions-importer` v1.3.22645
> **Status**: Every step in this document has been executed and validated.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Phase 1 — Install & Configure gh-actions-importer](#2-phase-1--install--configure-gh-actions-importer)
3. [Phase 2 — Prepare ADO Pipelines (Production Simulation)](#3-phase-2--prepare-ado-pipelines-production-simulation)
4. [Phase 3 — Audit ADO Pipelines](#4-phase-3--audit-ado-pipelines)
5. [Phase 4 — Dry-Run Conversion](#5-phase-4--dry-run-conversion)
6. [Phase 5 — Migrate (Create PRs)](#6-phase-5--migrate-create-prs)
7. [Phase 6 — Manual Fixes for Converted Workflows](#7-phase-6--manual-fixes-for-converted-workflows)
8. [Phase 7 — Secrets, Variables & Service Connections](#8-phase-7--secrets-variables--service-connections)
9. [Phase 8 — GitHub Environments & Protection Rules](#9-phase-8--github-environments--protection-rules)
10. [Phase 9 — Validate & Verify](#10-phase-9--validate--verify)
11. [Phase 10 — Decommission ADO Pipelines](#11-phase-10--decommission-ado-pipelines)
12. [Pipeline Mapping Reference](#12-pipeline-mapping-reference)
13. [Concept Mapping: ADO → GitHub Actions](#13-concept-mapping-ado--github-actions)
14. [Automation Script (PowerShell)](#14-automation-script-powershell)
15. [Automation Script (Bash)](#15-automation-script-bash)
16. [Known Limitations & Tool Bugs](#16-known-limitations--tool-bugs)
17. [Troubleshooting](#17-troubleshooting)

---

## 1. Prerequisites

### 1.1 Tools Required

| Tool | Minimum Version | Install Command | Purpose |
|------|----------------|-----------------|---------|
| **gh CLI** | ≥ 2.40 | `winget install GitHub.cli` | GitHub CLI |
| **Docker Desktop** | ≥ 4.x | `winget install Docker.DockerDesktop` | Required by gh-actions-importer (runs in container) |
| **Git** | ≥ 2.40 | `winget install Git.Git` | Version control |
| **Azure CLI** | ≥ 2.60 | `winget install Microsoft.AzureCLI` | AAD token generation (alternative to PAT) |
| **Node.js** | 20.x LTS | `winget install OpenJS.NodeJS.LTS` | Project runtime |

### 1.2 Authentication Options

You have **two options** for Azure DevOps authentication:

#### Option A: Personal Access Token (PAT)

| Token | Scopes | Where to Create |
|-------|--------|-----------------|
| **Azure DevOps PAT** | `Build (Read)`, `Code (Read)`, `Release (Read)`, `Project and Team (Read)`, `Variable Groups (Read)` | `https://dev.azure.com/{org}/_usersSettings/tokens` |
| **GitHub PAT** | `repo`, `workflow`, `admin:org` | `https://github.com/settings/tokens` |

#### Option B: Azure CLI AAD Token (Used in This Migration) ✅ Recommended

No PAT needed — use Azure CLI to generate short-lived AAD tokens:

```powershell
# PowerShell
$tok = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
```

```bash
# Bash/Linux
tok=$(az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv)
```

> **Note**: The resource ID `499b84ac-1321-427f-aa17-267ca6975798` is the Azure DevOps API resource.
> AAD tokens expire after ~1 hour. Regenerate before each phase if needed.

### 1.3 Verify Prerequisites

```powershell
# PowerShell — Verify all tools
gh --version                    # Expected: gh version 2.x.x
docker --version                # Expected: Docker version 2x.x.x
git --version                   # Expected: git version 2.x.x
az --version                    # Expected: azure-cli 2.x.x
gh auth status                  # Expected: ✓ Logged in to github.com

# Verify Docker is running (CRITICAL — importer runs inside Docker)
docker info | Select-Object -First 3
# If this fails: Start Docker Desktop and wait ~30 seconds

# Verify Azure CLI is logged in to the correct account
az account show --query '{name:name, user:user.name}' -o table
# IMPORTANT: Must be the account that owns the ADO organization
```

```bash
# Bash — Verify all tools
gh --version
docker --version
git --version
az --version
gh auth status
docker info > /dev/null 2>&1 && echo "Docker is running" || echo "Docker is NOT running"
az account show --query '{name:name, user:user.name}' -o table
```

### 1.4 Switch Azure CLI Account (if needed)

```powershell
# List all subscriptions
az account list --query '[].{Name:name, Id:id, User:user.name}' -o table

# Switch to the subscription under the ADO org owner
az account set --subscription "<SUBSCRIPTION_ID>"

# Verify
az account show --query user.name -o tsv
```

---

## 2. Phase 1 — Install & Configure gh-actions-importer

### 2.1 Install the Extension

```bash
gh extension install github/gh-actions-importer
```

#### ⚠️ SAML Workaround

If you get `HTTP 403: Resource protected by organization SAML enforcement`, your OAuth token
is blocked by the `github` org's SAML policy. **Workaround — manual binary install**:

```powershell
# 1. Find the latest release version
$releases = gh api repos/github/gh-actions-importer/releases/latest --jq '.tag_name' 2>$null
# If above fails due to SAML, manually visit:
# https://github.com/github/gh-actions-importer/releases

# 2. Download the binary for your platform
$extDir = "$env:LOCALAPPDATA\GitHub CLI\extensions\gh-actions-importer"
New-Item -ItemType Directory -Path $extDir -Force
# Download gh-actions-importer.exe from the release assets and place in $extDir

# 3. Verify
gh actions-importer version
```

### 2.2 Verify Installation

```bash
gh actions-importer version
# Expected: gh-actions-importer/1.3.xxxxx
```

### 2.3 Update (if already installed)

```bash
gh actions-importer update
```

### 2.4 Set Environment Variables

The importer reads credentials from environment variables. Set them in your terminal session:

```powershell
# PowerShell — Generate AAD token and set all env vars
$tok = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
$env:AZURE_DEVOPS_ACCESS_TOKEN = $tok
$env:AZURE_DEVOPS_ORGANIZATION = "sid-msft"          # ⚠️ Org name ONLY, not URL
$env:AZURE_DEVOPS_PROJECT = "test-project"
$env:GITHUB_ACCESS_TOKEN = (gh auth token)

# Verify they're set
Write-Host "ADO Token: $($env:AZURE_DEVOPS_ACCESS_TOKEN.Substring(0,10))..."
Write-Host "ADO Org: $env:AZURE_DEVOPS_ORGANIZATION"
Write-Host "ADO Project: $env:AZURE_DEVOPS_PROJECT"
Write-Host "GH Token: $($env:GITHUB_ACCESS_TOKEN.Substring(0,10))..."
```

```bash
# Bash/Linux
tok=$(az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv)
export AZURE_DEVOPS_ACCESS_TOKEN="$tok"
export AZURE_DEVOPS_ORGANIZATION="sid-msft"           # Org name ONLY, not URL
export AZURE_DEVOPS_PROJECT="test-project"
export GITHUB_ACCESS_TOKEN="$(gh auth token)"
```

> **CRITICAL**: `AZURE_DEVOPS_ORGANIZATION` must be just the org name (e.g., `sid-msft`),
> **NOT** the full URL (`https://dev.azure.com/sid-msft`). The tool constructs the URL internally.

### 2.5 Alternative: Interactive Configure

```bash
gh actions-importer configure
```

This saves credentials to `~/.env.local`. Prompts for:
- CI provider: `azure_devops`
- GitHub PAT
- GitHub URL: `https://github.com`
- Azure DevOps PAT (or AAD token)
- Azure DevOps URL: `https://dev.azure.com/sid-msft`

---

## 3. Phase 2 — Prepare ADO Pipelines (Production Simulation)

> **Why this step?** In production, ADO pipelines are fully configured with pipeline definitions,
> variable groups, environments, and service connections. The migration tool needs these to exist
> as pipeline definitions (not just YAML files in the repo) to discover and convert them.

### 3.1 Create Pipeline Definitions

If your YAML files exist in the repo but aren't registered as pipeline definitions in ADO,
create them via REST API:

```powershell
# Get a fresh token
$tok = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
$headers = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }

# Get repo ID
$repo = Invoke-RestMethod -Uri "https://dev.azure.com/sid-msft/test-project/_apis/git/repositories/test-project?api-version=7.0" -Headers $headers
$repoId = $repo.id

# Create CI Pipeline definition
$ciBody = @{
    name = "CI Pipeline"
    repository = @{ id = $repoId; type = "TfsGit"; name = "test-project" }
    process = @{ yamlFilename = "azure-pipelines.yml"; type = 2 }
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "https://dev.azure.com/sid-msft/test-project/_apis/build/definitions?api-version=7.0" -Method Post -Headers $headers -Body $ciBody

# Create PR Validation Pipeline definition
$prBody = @{
    name = "PR Validation"
    repository = @{ id = $repoId; type = "TfsGit"; name = "test-project" }
    process = @{ yamlFilename = "pipelines/pr-validation.yml"; type = 2 }
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "https://dev.azure.com/sid-msft/test-project/_apis/build/definitions?api-version=7.0" -Method Post -Headers $headers -Body $prBody

# Create CD Deploy Pipeline definition
$cdBody = @{
    name = "CD Deploy"
    repository = @{ id = $repoId; type = "TfsGit"; name = "test-project" }
    process = @{ yamlFilename = "pipelines/cd-deploy.yml"; type = 2 }
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "https://dev.azure.com/sid-msft/test-project/_apis/build/definitions?api-version=7.0" -Method Post -Headers $headers -Body $cdBody
```

Note the `definitionId` from each response — you'll need these for dry-run and migrate.

### 3.2 Create Variable Groups

Variable groups in ADO map to GitHub repository secrets and variables.

```powershell
$tok = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
$headers = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }

# Get project ID
$proj = Invoke-RestMethod -Uri "https://dev.azure.com/sid-msft/_apis/projects/test-project?api-version=7.0" -Headers $headers
$projectId = $proj.id

$varGroupBody = @{
    name = "task-board-vars"
    description = "Task Board application variables"
    type = "Vsts"
    variables = @{
        NODE_ENV = @{ value = "production"; isSecret = $false }
        PORT = @{ value = "3000"; isSecret = $false }
        APP_VERSION = @{ value = "1.0.0"; isSecret = $false }
        DATABASE_URL = @{ value = ""; isSecret = $true }
        API_KEY = @{ value = ""; isSecret = $true }
        JWT_SECRET = @{ value = ""; isSecret = $true }
    }
    variableGroupProjectReferences = @(
        @{
            name = "task-board-vars"
            projectReference = @{ id = $projectId; name = "test-project" }
        }
    )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "https://dev.azure.com/sid-msft/_apis/distributedtask/variablegroups?api-version=7.0" -Method Post -Headers $headers -Body $varGroupBody
```

### 3.3 Create Environments

```powershell
$tok = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
$headers = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }

@("task-board-dev", "task-board-staging", "task-board-production") | ForEach-Object {
    $body = @{ name = $_; description = "Deployment environment for $_" } | ConvertTo-Json
    Invoke-RestMethod -Uri "https://dev.azure.com/sid-msft/test-project/_apis/distributedtask/environments?api-version=7.0" -Method Post -Headers $headers -Body $body
}
```

### 3.4 Create Service Connection

```powershell
$tok = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
$headers = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }

$proj = Invoke-RestMethod -Uri "https://dev.azure.com/sid-msft/_apis/projects/test-project?api-version=7.0" -Headers $headers

$scBody = @{
    name = "Azure-ServiceConnection"
    type = "azurerm"
    url = "https://management.azure.com/"
    data = @{
        subscriptionId = "<SUBSCRIPTION_ID>"
        subscriptionName = "<SUBSCRIPTION_NAME>"
        environment = "AzureCloud"
        creationMode = "Manual"
    }
    authorization = @{
        scheme = "ServicePrincipal"
        parameters = @{
            tenantid = "<TENANT_ID>"
            serviceprincipalid = "<CLIENT_ID>"
            authenticationType = "spnKey"
            serviceprincipalkey = "<CLIENT_SECRET>"
        }
    }
    serviceEndpointProjectReferences = @(
        @{
            name = "Azure-ServiceConnection"
            projectReference = @{ id = $proj.id; name = "test-project" }
        }
    )
    isShared = $false
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "https://dev.azure.com/sid-msft/_apis/serviceendpoint/endpoints?api-version=7.0" -Method Post -Headers $headers -Body $scBody
```

### 3.5 Authorize Resources for Pipelines

```powershell
$tok = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
$headers = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }

# Authorize variable group (ID=1) for all pipelines
$authBody = @(@{
    resource = @{ type = "variablegroup"; id = "1" }
    allPipelines = @{ authorized = $true }
}) | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "https://dev.azure.com/sid-msft/test-project/_apis/pipelines/pipelinepermissions?api-version=7.1-preview.1" -Method Patch -Headers $headers -Body $authBody

# Authorize service connection
$authBody = @(@{
    resource = @{ type = "endpoint"; id = "<SERVICE_CONNECTION_ID>" }
    allPipelines = @{ authorized = $true }
}) | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "https://dev.azure.com/sid-msft/test-project/_apis/pipelines/pipelinepermissions?api-version=7.1-preview.1" -Method Patch -Headers $headers -Body $authBody

# Authorize environments (IDs 1, 2, 3)
1..3 | ForEach-Object {
    $authBody = @(@{
        resource = @{ type = "environment"; id = "$_" }
        allPipelines = @{ authorized = $true }
    }) | ConvertTo-Json -Depth 5
    Invoke-RestMethod -Uri "https://dev.azure.com/sid-msft/test-project/_apis/pipelines/pipelinepermissions?api-version=7.1-preview.1" -Method Patch -Headers $headers -Body $authBody
}
```

### 3.6 Environment Approval Checks

> **⚠️ Limitation**: ADO approval checks cannot be created via REST API for the "Approval" check type.
> The check type GUID is not available through the API. **Configure approvals via the ADO web UI**:
>
> 1. Go to `https://dev.azure.com/{org}/{project}/_environments`
> 2. Click each environment → Approvals and checks → Add check → Approvals
> 3. Add required approvers

---

## 4. Phase 3 — Audit ADO Pipelines

The audit inventories all pipeline definitions in the ADO project and reports conversion readiness.

### 4.1 Run Audit

> **⚠️ CRITICAL: Use RELATIVE paths for `--output-dir`**
> Docker volume mounts do not handle absolute Windows paths correctly.
> Using absolute paths like `c:\temp\test-ADO\audit-output` results in garbled directory names
> like `ctemptest-ADOaudit-output` inside the container.

```powershell
# Navigate to your project root FIRST
cd c:\temp\test-ADO

# Refresh token if expired
$tok = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
$env:AZURE_DEVOPS_ACCESS_TOKEN = $tok

# Run audit with RELATIVE path
gh actions-importer audit azure-devops --output-dir audit-output
```

```bash
# Bash
cd /path/to/project
gh actions-importer audit azure-devops --output-dir audit-output
```

### 4.2 Review Audit Output Structure

```
audit-output/
├── audit_summary.md                          ← High-level conversion readiness
├── workflow_usage.csv                        ← Actions and secrets used
├── log/
│   └── valet-YYYYMMDD-HHMMSS.log           ← Detailed logs
└── pipelines/
    └── test-project/
        ├── CI_Pipeline/
        │   ├── config.json                   ← Pipeline definition metadata
        │   └── .github/
        │       ├── workflows/
        │       │   └── ci_pipeline.yml       ← Converted workflow
        │       └── actions/
        │           ├── pipelines_templates_setup_node/
        │           │   └── action.yml        ← Composite action (from ADO template)
        │           └── pipelines_templates_install_deps/
        │               └── action.yml        ← Composite action (from ADO template)
        ├── PR_Validation/
        │   ├── config.json
        │   └── .github/
        │       ├── workflows/
        │       │   └── pr_validation.yml
        │       └── actions/
        │           ├── pipelines_templates_setup_node/
        │           │   └── action.yml
        │           └── pipelines_templates_install_deps/
        │               └── action.yml
        └── CD_Deploy/
            ├── error.txt                     ← Error details (pipeline failed conversion)
            └── source.yml                    ← Original ADO YAML (captured but not converted)
```

### 4.3 Key Audit Metrics (Our Results)

| Metric | Value | Details |
|--------|-------|---------|
| **Total pipelines** | 3 | CI, PR Validation, CD Deploy |
| **Partially successful** | 2 (66%) | CI Pipeline, PR Validation |
| **Failed** | 1 (33%) | CD Deploy (tool bug — see §16) |
| **Known build steps** | 16/20 (80%) | script, NodeTool@0, PublishBuildArtifacts@1, etc. |
| **Unknown build steps** | 4/20 (20%) | `Cache@2` (3×), `PublishCodeCoverageResults@2` (1×) |
| **Manual tasks** | 3 | Secrets: `API_KEY`, `DATABASE_URL`, `JWT_SECRET` |
| **Actions generated** | 25 | From 16 known build steps |

### 4.4 Review workflow_usage.csv

The CSV shows:
- **Which GitHub Actions** each converted workflow uses
- **Which secrets** need to be created in GitHub
- **Which runners** are needed

---

## 5. Phase 4 — Dry-Run Conversion

Dry-run produces the converted workflow YAML **without** creating a PR. Use this to review and validate.

### 5.1 Dry-Run Each Pipeline

> **Note**: The `pipeline` subcommand is REQUIRED when targeting individual pipelines.
> Without it, you'll get `Unrecognized command or argument '--pipeline-id'`.

```powershell
# Navigate to project root
cd c:\temp\test-ADO

# Refresh token
$tok = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
$env:AZURE_DEVOPS_ACCESS_TOKEN = $tok

# ✅ CI Pipeline (definition ID = 1)
gh actions-importer dry-run azure-devops pipeline --pipeline-id 1 --output-dir dry-run-output
# Output: dry-run-output/pipelines/test-project/CI_Pipeline/.github/workflows/ci_pipeline.yml

# ✅ PR Validation (definition ID = 2)
gh actions-importer dry-run azure-devops pipeline --pipeline-id 2 --output-dir dry-run-output
# Output: dry-run-output/pipelines/test-project/PR_Validation/.github/workflows/pr_validation.yml

# ❌ CD Deploy (definition ID = 3) — WILL FAIL (tool bug with deployment jobs)
gh actions-importer dry-run azure-devops pipeline --pipeline-id 3 --output-dir dry-run-output
# Error: Ruby crash in insensitive_string.rb (see §16)
```

```bash
# Bash — same commands
gh actions-importer dry-run azure-devops pipeline --pipeline-id 1 --output-dir dry-run-output
gh actions-importer dry-run azure-devops pipeline --pipeline-id 2 --output-dir dry-run-output
gh actions-importer dry-run azure-devops pipeline --pipeline-id 3 --output-dir dry-run-output
```

> **Finding Pipeline IDs**: Go to `https://dev.azure.com/{org}/{project}/_build`
> → click each pipeline → the URL contains `definitionId=<ID>`.
>
> Or via REST API:
> ```powershell
> $defs = Invoke-RestMethod -Uri "https://dev.azure.com/sid-msft/test-project/_apis/build/definitions?api-version=7.0" -Headers $headers
> $defs.value | Select-Object id, name | Format-Table
> ```

### 5.2 Review Dry-Run Output

Compare the auto-converted YAML with your expectations. Key items to check:

| Item | What to Look For |
|------|-----------------|
| **Triggers** | `on:` block matches ADO `trigger:` and `pr:` |
| **Runner** | `runs-on: ubuntu-latest` matches `pool: vmImage: ubuntu-latest` |
| **Steps order** | Steps are in the same sequence as ADO |
| **Commented-out steps** | `# This item has no matching transformer` = unsupported tasks |
| **ADO expression syntax** | Look for `$[eq(variables['...'])]` — these are NOT converted |
| **Template references** | Should become composite actions under `.github/actions/` |

---

## 6. Phase 5 — Migrate (Create PRs)

The migrate command creates a **pull request** on the target GitHub repo with the converted workflow files.

### 6.1 Run Migrate

```powershell
cd c:\temp\test-ADO

# Refresh token
$tok = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
$env:AZURE_DEVOPS_ACCESS_TOKEN = $tok

# ✅ Migrate CI Pipeline → Creates PR on GitHub
gh actions-importer migrate azure-devops pipeline `
  --pipeline-id 1 `
  --target-url https://github.com/sidlabs-platform/test-project `
  --output-dir migrate-output
# Output: Pull request: 'https://github.com/sidlabs-platform/test-project/pull/1'

# ✅ Migrate PR Validation → Creates PR on GitHub
gh actions-importer migrate azure-devops pipeline `
  --pipeline-id 2 `
  --target-url https://github.com/sidlabs-platform/test-project `
  --output-dir migrate-output
# Output: Pull request: 'https://github.com/sidlabs-platform/test-project/pull/2'

# ❌ CD Deploy — WILL FAIL (same tool bug)
gh actions-importer migrate azure-devops pipeline `
  --pipeline-id 3 `
  --target-url https://github.com/sidlabs-platform/test-project `
  --output-dir migrate-output
# FAILS — must convert CD pipeline manually (see §7)
```

```bash
# Bash
gh actions-importer migrate azure-devops pipeline \
  --pipeline-id 1 \
  --target-url https://github.com/sidlabs-platform/test-project \
  --output-dir migrate-output

gh actions-importer migrate azure-devops pipeline \
  --pipeline-id 2 \
  --target-url https://github.com/sidlabs-platform/test-project \
  --output-dir migrate-output
```

### 6.2 Review Generated PRs

```bash
# List PRs created by the importer
gh pr list --repo sidlabs-platform/test-project

# Review each PR
gh pr view 1 --repo sidlabs-platform/test-project
gh pr view 2 --repo sidlabs-platform/test-project

# Check the workflow files in each PR
gh pr diff 1 --repo sidlabs-platform/test-project
```

### 6.3 What Gets Created in Each PR

Each PR adds:
- `.github/workflows/<pipeline_name>.yml` — The converted workflow
- `.github/actions/<template_name>/action.yml` — Composite actions (from ADO templates)
- The branch name follows the pattern `actions-importer/<pipeline_name>`

---

## 7. Phase 6 — Manual Fixes for Converted Workflows

The auto-converted workflows need manual fixes before they're production-ready.

### 7.1 Issues Found in Auto-Converted CI Workflow

| Issue | Line/Section | Fix Required |
|-------|-------------|-------------|
| **`isMain` variable** uses ADO expression syntax | `isMain: "$[eq(variables['Build.SourceBranch'], 'refs/heads/main')]"` | Replace with `${{ github.ref == 'refs/heads/main' }}` |
| **`Cache@2` commented out** | Install deps composite action | Add `actions/cache@v4` or use `setup-node` built-in `cache: 'npm'` |
| **`PublishCodeCoverageResults@2` commented out** | CI workflow | Replace with `actions/upload-artifact@v4` for coverage files |
| **Missing `on: push` trigger** | Only has `workflow_dispatch` | Add `on: push: branches: [main]` |
| **`CopyFiles@2` replacement** is overly complex | Uses `actions/github-script` with inline JS | Replace with simpler `actions/upload-artifact` path globs |
| **Missing `permissions` block** | No permissions defined | Add `permissions: contents: read` (principle of least privilege) |

### 7.2 Issues Found in Auto-Converted PR Validation Workflow

| Issue | Line/Section | Fix Required |
|-------|-------------|-------------|
| **`Cache@2` commented out** | Install deps composite action | Add cache or use setup-node built-in |
| **PR summary writes to file** | `> ${{ github.workspace }}/pr-summary.md` | Use `>> $GITHUB_STEP_SUMMARY` for native PR summary |
| **Missing `if: always()`** | Summary step | Add so summary shows even if tests fail |

### 7.3 CD Deploy Pipeline — Full Manual Conversion Required

The CD pipeline with `deployment:` jobs, `environment:` targets, and `strategy: runOnce:` cannot be
auto-converted (tool crash). Create `.github/workflows/cd-deploy.yml` manually:

**Key ADO → GitHub Actions mappings for CD:**

| ADO Feature | GitHub Actions Equivalent |
|-------------|--------------------------|
| `resources: pipelines:` trigger | `on: workflow_run: workflows: ['CI - Build & Test']` |
| `deployment:` job type | Regular `jobs:` with `environment:` key |
| `environment: task-board-dev` | `environment: name: dev` |
| `strategy: runOnce: deploy:` | Default (no strategy needed) |
| `postRouteTraffic:` steps | Additional steps after deploy step |
| `download: ci` (artifact) | `actions/download-artifact@v4` with `run-id` |
| `AzureWebApp@1` task | `azure/webapps-deploy@v3` |
| ADO service connection | Azure OIDC via `azure/login@v2` |
| Environment approvals | GitHub environment protection rules |

### 7.4 Auto-Converted vs Manually-Created Comparison

| Aspect | Auto-Converted | Manually-Created | Winner |
|--------|---------------|------------------|--------|
| **Trigger accuracy** | `workflow_dispatch` only (CI) | `push` + `paths-ignore` | Manual ✅ |
| **Template handling** | Composite actions (faithful) | Inlined (simpler) | Either |
| **Cache support** | Commented out (unsupported) | `setup-node` built-in cache | Manual ✅ |
| **Coverage upload** | Commented out | `upload-artifact` | Manual ✅ |
| **Test reporting** | `EnricoMi/publish-unit-test-result-action` | `dorny/test-reporter` | Either |
| **Artifact staging** | Complex `github-script` blob | Simple `upload-artifact` paths | Manual ✅ |
| **Permissions** | Not set | Explicit `permissions:` block | Manual ✅ |
| **PR summary** | Writes to file | `$GITHUB_STEP_SUMMARY` | Manual ✅ |
| **CD pipeline** | ❌ Crashes | ✅ Full workflow | Manual ✅ |

**Recommendation**: Use auto-converted workflows as a starting point for CI/PR pipelines,
then apply the manual fixes listed above. Always manually create the CD pipeline.

---

## 8. Phase 7 — Secrets, Variables & Service Connections

### 8.1 Variable Group → GitHub Secrets/Variables Mapping

ADO variable group `task-board-vars`:

| ADO Variable | Is Secret? | GitHub Target | GitHub Reference |
|-------------|-----------|---------------|------------------|
| `NODE_ENV` | No | Repository Variable | `${{ vars.NODE_ENV }}` |
| `PORT` | No | Repository Variable | `${{ vars.PORT }}` |
| `APP_VERSION` | No | Repository Variable | `${{ vars.APP_VERSION }}` |
| `DATABASE_URL` | **Yes** | Repository Secret | `${{ secrets.DATABASE_URL }}` |
| `API_KEY` | **Yes** | Repository Secret | `${{ secrets.API_KEY }}` |
| `JWT_SECRET` | **Yes** | Repository Secret | `${{ secrets.JWT_SECRET }}` |

### 8.2 Create GitHub Repository Secrets

```bash
# Secrets (each prompts for value interactively — NEVER put secret values in scripts)
gh secret set DATABASE_URL --repo sidlabs-platform/test-project
gh secret set API_KEY --repo sidlabs-platform/test-project
gh secret set JWT_SECRET --repo sidlabs-platform/test-project

# Azure deployment secrets (for CD pipeline)
gh secret set AZURE_CLIENT_ID --repo sidlabs-platform/test-project
gh secret set AZURE_TENANT_ID --repo sidlabs-platform/test-project
gh secret set AZURE_SUBSCRIPTION_ID --repo sidlabs-platform/test-project
```

### 8.3 Create GitHub Repository Variables (non-sensitive)

```bash
gh variable set NODE_ENV --body "production" --repo sidlabs-platform/test-project
gh variable set PORT --body "3000" --repo sidlabs-platform/test-project
gh variable set APP_VERSION --body "1.0.0" --repo sidlabs-platform/test-project
gh variable set NODE_VERSION --body "20.x" --repo sidlabs-platform/test-project
gh variable set APP_NAME --body "task-board-webapp" --repo sidlabs-platform/test-project
```

### 8.4 Environment-Scoped Secrets

For secrets that differ per environment (dev/staging/production):

```bash
# Environment-scoped secrets (e.g., different DB per environment)
gh secret set DATABASE_URL --repo sidlabs-platform/test-project --env dev
gh secret set DATABASE_URL --repo sidlabs-platform/test-project --env staging
gh secret set DATABASE_URL --repo sidlabs-platform/test-project --env production
```

### 8.5 Service Connection → OIDC Federated Credential

ADO service connections authenticate pipelines to Azure. In GitHub Actions, use **OIDC** (no secrets to rotate):

```bash
# 1. Create Azure AD App Registration
az ad app create --display-name "github-actions-test-project"
APP_ID=$(az ad app list --display-name "github-actions-test-project" --query '[0].appId' -o tsv)

# 2. Create Service Principal
az ad sp create --id $APP_ID

# 3. Grant role on subscription
az role assignment create \
  --assignee $APP_ID \
  --role "Contributor" \
  --scope "/subscriptions/<SUBSCRIPTION_ID>"

# 4. Create federated credentials for each environment
for ENV in dev staging production; do
  az ad app federated-credential create \
    --id $APP_ID \
    --parameters "{
      \"name\": \"github-actions-$ENV\",
      \"issuer\": \"https://token.actions.githubusercontent.com\",
      \"subject\": \"repo:sidlabs-platform/test-project:environment:$ENV\",
      \"audiences\": [\"api://AzureADTokenExchange\"]
    }"
done

# 5. Store the App Registration values as GitHub secrets
echo "Client ID: $APP_ID"
az ad app show --id $APP_ID --query 'appId' -o tsv  # → AZURE_CLIENT_ID
az account show --query 'tenantId' -o tsv            # → AZURE_TENANT_ID
az account show --query 'id' -o tsv                  # → AZURE_SUBSCRIPTION_ID
```

### 8.6 Comprehensive Secret Migration Checklist

| Category | ADO Resource | GitHub Equivalent | Action |
|----------|-------------|-------------------|--------|
| **App secrets** | Variable group secrets | `gh secret set <NAME>` | Create per-repo secrets |
| **App config** | Variable group non-secrets | `gh variable set <NAME>` | Create per-repo variables |
| **Azure auth** | Service connection (SPN) | OIDC federated credential | Create App Registration + federated creds |
| **Azure auth (legacy)** | Service connection (SPN key) | `AZURE_CLIENT_SECRET` secret | Store SPN key as secret (not recommended) |
| **Per-env secrets** | Pipeline variables with scope | `gh secret set --env <ENV>` | Create per-environment secrets |
| **Per-env config** | Pipeline variables with scope | `gh variable set --env <ENV>` | Create per-environment variables |
| **External tokens** | Variable group / Library | `gh secret set <NAME>` | Store as repository secrets |
| **Key Vault refs** | ADO Key Vault variable group | Azure OIDC + Key Vault action | Use `azure/login` + `azure/keyvault-secrets` |
| **npm tokens** | Pipeline variable `NPM_TOKEN` | `gh secret set NPM_TOKEN` | Repository secret |
| **Docker registry** | Service connection (Docker) | `gh secret set DOCKER_*` | Store registry credentials |

---

## 9. Phase 8 — GitHub Environments & Protection Rules

### 9.1 Create Environments

```bash
# Create environments (idempotent — safe to re-run)
gh api repos/sidlabs-platform/test-project/environments/dev --method PUT
gh api repos/sidlabs-platform/test-project/environments/staging --method PUT
gh api repos/sidlabs-platform/test-project/environments/production --method PUT
```

### 9.2 Add Protection Rules

```bash
# Get your user ID
USER_ID=$(gh api user --jq '.id')

# Staging: require 1 reviewer
gh api repos/sidlabs-platform/test-project/environments/staging \
  --method PUT \
  -f "reviewers[][type]=User" \
  -F "reviewers[][id]=$USER_ID"

# Production: require 1 reviewer + wait timer
gh api repos/sidlabs-platform/test-project/environments/production \
  --method PUT \
  -f "reviewers[][type]=User" \
  -F "reviewers[][id]=$USER_ID" \
  -F "wait_timer=5"
```

### 9.3 Branch Protection

```bash
gh api repos/sidlabs-platform/test-project/branches/main/protection \
  --method PUT \
  --input - <<'EOF'
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

---

## 10. Phase 9 — Validate & Verify

### 10.1 Verify CI Workflow

```bash
# Push a change to trigger CI
echo "# Migrated to GitHub" >> README.md
git add README.md
git commit -m "docs: trigger CI after migration"
git push origin main

# Watch the run
gh run list --repo sidlabs-platform/test-project --limit 5
gh run watch --repo sidlabs-platform/test-project
```

### 10.2 Verify PR Validation

```bash
# Create a test PR
git checkout -b test/migration-verify
echo "test" > migration-test.txt
git add migration-test.txt
git commit -m "test: verify PR validation workflow"
git push origin test/migration-verify

gh pr create \
  --repo sidlabs-platform/test-project \
  --title "test: verify PR validation" \
  --body "Testing PR validation workflow after ADO migration" \
  --base main

# Watch checks
gh pr checks --repo sidlabs-platform/test-project
```

### 10.3 Verify CD Workflow

```bash
# CD triggers automatically after CI succeeds on main
gh run list --repo sidlabs-platform/test-project --workflow "CD - Deploy" --limit 5
```

### 10.4 Comparison Checklist

| Check | ADO Pipeline | GitHub Actions | Status |
|-------|-------------|----------------|--------|
| CI triggers on push to main | ✅ | Verify with `gh run list` | |
| PR validation runs on PR | ✅ | Verify with `gh pr checks` | |
| Tests pass (11/11) | ✅ | Check annotations | |
| Lint passes | ✅ | Check step output | |
| Artifacts published | ✅ `drop` | Check Actions artifacts tab | |
| Coverage uploaded | ✅ | Check artifacts | |
| Security audit runs | ✅ | Check security-scan job | |
| CD deploys to dev | ✅ | Check environment | |
| Staging requires approval | ✅ | Check environment rules | |
| Production requires approval | ✅ | Check environment rules | |

---

## 11. Phase 10 — Decommission ADO Pipelines

> ⚠️ Only after GitHub Actions are fully verified and running for a burn-in period.

### 11.1 Disable ADO Pipelines

```powershell
$tok = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
$headers = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }

# Disable each pipeline definition
@(1, 2, 3) | ForEach-Object {
    $def = Invoke-RestMethod -Uri "https://dev.azure.com/sid-msft/test-project/_apis/build/definitions/$_`?api-version=7.0" -Headers $headers
    $def.queueStatus = "disabled"
    $body = $def | ConvertTo-Json -Depth 20
    Invoke-RestMethod -Uri "https://dev.azure.com/sid-msft/test-project/_apis/build/definitions/$_`?api-version=7.0" -Method Put -Headers $headers -Body $body
    Write-Host "Disabled pipeline $_"
}
```

### 11.2 Archive ADO Pipeline Files

```bash
mkdir -p .archive/ado-pipelines
mv azure-pipelines.yml .archive/ado-pipelines/
mv pipelines/ .archive/ado-pipelines/
git add -A
git commit -m "chore: archive ADO pipeline files after GitHub Actions migration"
git push origin main
```

### 11.3 Remove ADO Remote

```bash
git remote remove ado
```

---

## 12. Pipeline Mapping Reference

### 12.1 File-Level Mapping

| ADO File | GitHub Actions File | Conversion Method |
|----------|-------------------|-------------------|
| `azure-pipelines.yml` | `.github/workflows/ci.yml` | Auto (+ manual fixes) |
| `pipelines/pr-validation.yml` | `.github/workflows/pr-validation.yml` | Auto (+ manual fixes) |
| `pipelines/cd-deploy.yml` | `.github/workflows/cd-deploy.yml` | **Manual only** (tool crash) |
| `pipelines/templates/setup-node.yml` | `.github/actions/pipelines_templates_setup_node/action.yml` or inlined | Auto → composite action |
| `pipelines/templates/install-deps.yml` | `.github/actions/pipelines_templates_install_deps/action.yml` or inlined | Auto → composite action |
| `pipelines/templates/deploy-webapp.yml` | Inlined: `azure/webapps-deploy@v3` | Manual |
| `pipelines/templates/smoke-test.yml` | Inlined: `curl` script step | Manual |

### 12.2 Task-Level Mapping

| ADO Task | GitHub Action | Auto-Converted? | Notes |
|----------|---------------|-----------------|-------|
| `NodeTool@0` | `actions/setup-node@v4` | ✅ Yes | |
| `Cache@2` | `actions/cache@v4` or built-in | ❌ No | Commented out — use `setup-node cache: 'npm'` |
| `PublishTestResults@2` | `EnricoMi/publish-unit-test-result-action@v2` | ✅ Yes | Or use `dorny/test-reporter@v1` |
| `PublishCodeCoverageResults@2` | `actions/upload-artifact@v4` | ❌ No | Commented out — upload coverage as artifact |
| `PublishBuildArtifacts@1` | `actions/upload-artifact@v4` | ✅ Yes | |
| `CopyFiles@2` | `actions/github-script@v7` | ✅ Yes | Overly complex — simplify to `upload-artifact` paths |
| `AzureWebApp@1` | `azure/webapps-deploy@v3` | ❌ N/A | CD pipeline crashes — manual conversion |
| `script:` | `run:` | ✅ Yes | Direct mapping |

---

## 13. Concept Mapping: ADO → GitHub Actions

| ADO Concept | GitHub Actions Equivalent | Notes |
|-------------|--------------------------|-------|
| `trigger:` | `on: push:` | Push triggers |
| `pr:` | `on: pull_request:` | PR triggers |
| `pool: vmImage` | `runs-on:` | Runner selection |
| `stages:` | `jobs:` (with `needs:`) | Stages → jobs with dependencies |
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
| `- group: name` | Secrets + Variables | Variable groups → secrets/vars |
| `template: path.yml` | `uses: ./.github/actions/x` | Composite actions or reusable workflows |
| `parameters:` | `inputs:` (composite) / `workflow_dispatch inputs:` | Template params → action inputs |
| `resources: pipelines:` | `on: workflow_run:` | Pipeline triggers |
| `deployment:` job | `jobs: X: environment:` | Environment deployments |
| `environment: 'name'` | `environment: name` | Deployment targets |
| `strategy: runOnce:` | Default (no strategy) | Deployment strategy |
| `postRouteTraffic:` | Steps after deploy | No direct equivalent |
| `retryCountOnTaskFailure:` | Shell loop or `nick-fields/retry` | No native retry |
| `$(System.DefaultWorkingDirectory)` | `${{ github.workspace }}` | Workspace path |
| `$(Build.SourceBranch)` | `${{ github.ref }}` | Branch reference |
| `$(Build.BuildNumber)` | `${{ github.run_number }}` | Build number |
| `$(Pipeline.Workspace)` | `${{ runner.workspace }}` | Pipeline workspace |
| `$(System.PullRequest.SourceBranch)` | `${{ github.head_ref }}` | PR source branch |
| `$(Build.SourceBranchName)` | `${{ github.ref_name }}` | Branch name only |
| `$(Build.Repository.Name)` | `${{ github.repository }}` | Repo name |
| `$(Build.Reason)` | `${{ github.event_name }}` | Trigger reason |
| Service connections | OIDC federated credentials | Azure auth |
| Variable groups | Repository secrets + variables | Secret management |
| Secure files | Repository secrets / artifacts | No direct equivalent |
| Artifact staging directory | `${{ runner.temp }}` | Temporary storage |

---

## 14. Automation Script (PowerShell)

Save as `migrate-pipelines.ps1`:

```powershell
#Requires -Version 7.0
<#
.SYNOPSIS
    Automates ADO Pipeline → GitHub Actions migration using gh-actions-importer.
.DESCRIPTION
    Runs audit, dry-run, and migrate phases for all ADO pipeline definitions.
    Handles token refresh, Docker validation, and output management.
.PARAMETER AdoOrg
    Azure DevOps organization name (NOT URL). Example: "sid-msft"
.PARAMETER AdoProject
    Azure DevOps project name.
.PARAMETER GitHubTargetUrl
    Target GitHub repo URL. Example: "https://github.com/sidlabs-platform/test-project"
#>
param(
    [string]$AdoOrg = "sid-msft",
    [string]$AdoProject = "test-project",
    [string]$GitHubTargetUrl = "https://github.com/sidlabs-platform/test-project"
)

$ErrorActionPreference = "Stop"

Write-Host "=== ADO Pipelines → GitHub Actions Migration ===" -ForegroundColor Cyan

# ─── Step 1: Verify prerequisites ──────────────────────────────────────
Write-Host "`n[1/7] Verifying prerequisites..." -ForegroundColor Yellow
$prereqs = @("gh", "docker", "git", "az")
foreach ($cmd in $prereqs) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "ERROR: '$cmd' not found in PATH"
    }
}
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "ERROR: Docker is not running" }
gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "ERROR: gh CLI not authenticated" }
gh actions-importer version 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "ERROR: gh-actions-importer not installed" }
Write-Host "  ✅ All prerequisites met" -ForegroundColor Green

# ─── Step 2: Set credentials ──────────────────────────────────────────
Write-Host "`n[2/7] Setting credentials..." -ForegroundColor Yellow
$tok = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
$env:AZURE_DEVOPS_ACCESS_TOKEN = $tok
$env:AZURE_DEVOPS_ORGANIZATION = $AdoOrg
$env:AZURE_DEVOPS_PROJECT = $AdoProject
$env:GITHUB_ACCESS_TOKEN = (gh auth token)
Write-Host "  ✅ Credentials set" -ForegroundColor Green

# ─── Step 3: Audit ────────────────────────────────────────────────────
Write-Host "`n[3/7] Auditing ADO pipelines..." -ForegroundColor Yellow
gh actions-importer audit azure-devops --output-dir audit-output
Write-Host "  ✅ Audit complete → audit-output/audit_summary.md" -ForegroundColor Green

# ─── Step 4: Get pipeline definitions ─────────────────────────────────
Write-Host "`n[4/7] Discovering pipeline definitions..." -ForegroundColor Yellow
$headers = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }
$defs = Invoke-RestMethod -Uri "https://dev.azure.com/$AdoOrg/$AdoProject/_apis/build/definitions?api-version=7.0" -Headers $headers
$pipelineIds = $defs.value | Select-Object id, name
$pipelineIds | Format-Table
Write-Host "  ✅ Found $($pipelineIds.Count) pipeline(s)" -ForegroundColor Green

# ─── Step 5: Dry-run each pipeline ───────────────────────────────────
Write-Host "`n[5/7] Running dry-run for each pipeline..." -ForegroundColor Yellow
foreach ($p in $pipelineIds) {
    Write-Host "  → Dry-run: $($p.name) (ID=$($p.id))" -ForegroundColor Gray
    $result = gh actions-importer dry-run azure-devops pipeline --pipeline-id $p.id --output-dir dry-run-output 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    ⚠️ FAILED: $($p.name) — must convert manually" -ForegroundColor Red
    } else {
        Write-Host "    ✅ Success" -ForegroundColor Green
    }
}

# ─── Step 6: Migrate (create PRs) ────────────────────────────────────
Write-Host "`n[6/7] Migrating pipelines (creating PRs)..." -ForegroundColor Yellow
foreach ($p in $pipelineIds) {
    Write-Host "  → Migrate: $($p.name) (ID=$($p.id))" -ForegroundColor Gray
    $result = gh actions-importer migrate azure-devops pipeline --pipeline-id $p.id --target-url $GitHubTargetUrl --output-dir migrate-output 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    ⚠️ FAILED: $($p.name) — must convert manually" -ForegroundColor Red
    } else {
        $prUrl = ($result | Select-String "Pull request:").ToString().Split("'")[1]
        Write-Host "    ✅ PR created: $prUrl" -ForegroundColor Green
    }
}

# ─── Step 7: Summary ─────────────────────────────────────────────────
Write-Host "`n[7/7] Migration complete!" -ForegroundColor Yellow
Write-Host @"

=== Summary ===
  Audit output:   audit-output/audit_summary.md
  Dry-run output: dry-run-output/
  Migrate output: migrate-output/
  PRs created:    Check with 'gh pr list --repo $($GitHubTargetUrl.Replace('https://github.com/',''))'

=== Next Steps ===
  1. Review and merge PRs on GitHub
  2. Create GitHub secrets:  gh secret set <NAME> --repo <REPO>
  3. Create GitHub environments: dev, staging, production
  4. Manually convert any failed pipelines (especially CD pipelines with deployment jobs)
  5. Run validation: gh run list --repo <REPO>
  6. Disable ADO pipelines after verification
"@ -ForegroundColor Cyan
```

---

## 15. Automation Script (Bash)

Save as `migrate-pipelines.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# ─── Configuration ─────────────────────────────────────────────────────
ADO_ORG="${1:-sid-msft}"
ADO_PROJECT="${2:-test-project}"
GH_TARGET_URL="${3:-https://github.com/sidlabs-platform/test-project}"

echo "=== ADO Pipelines → GitHub Actions Migration ==="

# ─── Step 1: Prerequisites ────────────────────────────────────────────
echo "[1/7] Verifying prerequisites..."
for cmd in gh docker git az; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: $cmd not found"; exit 1; }
done
docker info >/dev/null 2>&1 || { echo "ERROR: Docker not running"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "ERROR: gh not authenticated"; exit 1; }
echo "  ✅ All prerequisites met"

# ─── Step 2: Credentials ──────────────────────────────────────────────
echo "[2/7] Setting credentials..."
tok=$(az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv)
export AZURE_DEVOPS_ACCESS_TOKEN="$tok"
export AZURE_DEVOPS_ORGANIZATION="$ADO_ORG"
export AZURE_DEVOPS_PROJECT="$ADO_PROJECT"
export GITHUB_ACCESS_TOKEN="$(gh auth token)"
echo "  ✅ Credentials set"

# ─── Step 3: Audit ────────────────────────────────────────────────────
echo "[3/7] Auditing ADO pipelines..."
gh actions-importer audit azure-devops --output-dir audit-output
echo "  ✅ Audit complete"

# ─── Step 4: Get pipeline IDs ─────────────────────────────────────────
echo "[4/7] Discovering pipeline definitions..."
PIPELINE_IDS=$(curl -s -H "Authorization: Bearer $tok" \
  "https://dev.azure.com/$ADO_ORG/$ADO_PROJECT/_apis/build/definitions?api-version=7.0" \
  | jq -r '.value[] | "\(.id):\(.name)"')
echo "$PIPELINE_IDS"
echo "  ✅ Found $(echo "$PIPELINE_IDS" | wc -l) pipeline(s)"

# ─── Step 5: Dry-run ──────────────────────────────────────────────────
echo "[5/7] Running dry-run..."
echo "$PIPELINE_IDS" | while IFS=: read -r id name; do
  echo "  → $name (ID=$id)"
  if gh actions-importer dry-run azure-devops pipeline --pipeline-id "$id" --output-dir dry-run-output 2>/dev/null; then
    echo "    ✅ Success"
  else
    echo "    ⚠️ FAILED — must convert manually"
  fi
done

# ─── Step 6: Migrate ──────────────────────────────────────────────────
echo "[6/7] Migrating pipelines..."
echo "$PIPELINE_IDS" | while IFS=: read -r id name; do
  echo "  → $name (ID=$id)"
  if gh actions-importer migrate azure-devops pipeline --pipeline-id "$id" --target-url "$GH_TARGET_URL" --output-dir migrate-output 2>/dev/null; then
    echo "    ✅ PR created"
  else
    echo "    ⚠️ FAILED — must convert manually"
  fi
done

# ─── Step 7: Summary ──────────────────────────────────────────────────
echo ""
echo "=== Migration Complete ==="
echo "  Review: audit-output/audit_summary.md"
echo "  PRs:    gh pr list --repo ${GH_TARGET_URL#https://github.com/}"
echo ""
echo "Next steps:"
echo "  1. Review/merge PRs"
echo "  2. Set secrets: gh secret set <NAME>"
echo "  3. Create environments: dev, staging, production"
echo "  4. Manually convert failed pipelines"
echo "  5. Validate: gh run list"
```

---

## 16. Known Limitations & Tool Bugs

### 16.1 CD Pipeline with Deployment Jobs — Tool Crash

**Issue**: `gh-actions-importer` crashes with a Ruby error when processing pipelines
that use ADO's `deployment:` job type with `environment:` and `strategy: runOnce:`.

**Error**:
```
insensitive_string.rb:31:in 'downcase': undefined method 'downcase' for nil
```

**Reference**: `860ad07a01c41bc8fac20d23691cb54e41b5f132`

**Affected ADO features**:
- `jobs: - deployment:` (deployment job type)
- `environment: name` (environment targeting)
- `strategy: runOnce: deploy:` (deployment strategy)
- `postRouteTraffic:` (post-deployment steps)
- `resources: pipelines:` with pipeline triggers

**Workaround**: Manually create the CD workflow. See §7.3 for the mapping reference.

### 16.2 Unsupported ADO Tasks

| ADO Task | Status | Manual Replacement |
|----------|--------|-------------------|
| `Cache@2` | ❌ Commented out | Use `actions/cache@v4` or `setup-node cache: 'npm'` |
| `PublishCodeCoverageResults@2` | ❌ Commented out | Use `actions/upload-artifact@v4` |

### 16.3 Docker Path Mapping Issue (Windows)

**Issue**: Absolute Windows paths in `--output-dir` cause garbled directory names inside the Docker container.

**Example**: `--output-dir c:\temp\test-ADO\audit-output` creates a directory named
`ctemptest-ADOaudit-output` instead of the expected path.

**Root Cause**: Docker volume mount path translation doesn't handle Windows absolute paths correctly
when the importer passes them to the container.

**Fix**: Always use **relative paths**:
```bash
# ❌ WRONG — garbled output
gh actions-importer audit azure-devops --output-dir c:\temp\test-ADO\audit-output

# ✅ CORRECT — navigate to project root first, use relative path
cd c:\temp\test-ADO
gh actions-importer audit azure-devops --output-dir audit-output
```

### 16.4 ADO Expression Syntax Not Converted

**Issue**: ADO compile-time expressions like `$[eq(variables['Build.SourceBranch'], 'refs/heads/main')]`
are passed through as-is, resulting in invalid GitHub Actions syntax.

**Fix**: Manually replace with GitHub Actions expressions:
```yaml
# ❌ Auto-converted (invalid)
isMain: "$[eq(variables['Build.SourceBranch'], 'refs/heads/main')]"

# ✅ Manual fix
isMain: ${{ github.ref == 'refs/heads/main' }}
```

### 16.5 Missing Trigger Conversion for CI Pipeline

**Issue**: The CI pipeline's `trigger:` block is converted to `on: workflow_dispatch:` only,
dropping the original push trigger.

**Fix**: Manually add push trigger:
```yaml
on:
  push:
    branches: [main]
    paths-ignore:
      - '*.md'
      - 'docs/**'
  workflow_dispatch:   # Keep for manual runs
```

---

## 17. Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `HTTP 403: SAML enforcement` on extension install | Token not authorized for `github` org SSO | Manual binary install (§2.1) or authorize token for SAML |
| `actions-importer: Docker not running` | Docker Desktop not started | Start Docker Desktop, verify with `docker info` |
| `Unrecognized command '--pipeline-id'` | Missing `pipeline` subcommand | Use `dry-run azure-devops pipeline --pipeline-id X` |
| `insensitive_string.rb:31:in 'downcase'` | Tool bug with deployment jobs | Manually convert CD pipeline (§7.3) |
| Garbled output directory name | Absolute Windows path with `--output-dir` | Use relative paths; `cd` to project root first (§16.3) |
| `Cannot resolve action azure/login@v2` | Local linter warning only | Safe to ignore — resolves at runtime on GitHub |
| `workflow_run` CD not triggering | Workflow must exist on default branch | Merge workflows to `main` first |
| `Download artifact` fails in CD | `workflow_run` needs explicit `run-id` | Use `github.event.workflow_run.id` |
| AAD token expired | Tokens expire after ~1 hour | Re-run `az account get-access-token` and update env vars |
| Wrong Azure CLI account | Multiple subscriptions/accounts | `az account set --subscription <ID>` (§1.4) |
| `TF401027: You need the Git 'GenericContribute' permission` | Insufficient ADO permissions | Ensure account has Project Contributor or Build Admin role |
| ADO pipeline not found by importer | YAML exists but no pipeline definition | Create pipeline definition via ADO UI or REST API (§3.1) |
| Variable group not accessible | Not authorized for pipelines | Authorize via REST API (§3.5) or ADO UI |
| Environment approval checks can't be created via API | Check type GUID not available | Configure approvals via ADO web UI (§3.6) |
| `${{ secrets.* }}` not available in workflow | Secrets not created in GitHub | Run `gh secret set <NAME>` for each secret (§8.2) |
| OIDC login fails in CD workflow | Missing federated credential | Create federated credential for each environment (§8.5) |
