# Agent 101 Tool Inventory

## Implemented Local Tools

| Tool | Purpose | Approval |
| --- | --- | --- |
| `inspect_business_state` | Read local tasks, artifacts, approvals, runs, knowledge counts | Automatic |
| `list_offices` | List bounded offices available to Agent 101 | Automatic |
| `search_business_knowledge` | Retrieve approved/draft knowledge | Automatic |
| `create_task_contract` | Preserve scope, deliverables, success criteria, constraints | Automatic |
| `create_plan` | Build bounded plan steps with success checks | Automatic |
| `save_artifact` | Save local draft artifact with evidence | Automatic |
| `propose_memory` | Create sourced memory proposal | Automatic for working memory |
| `create_approval_request` | Create scoped Human Gate request | Automatic to request, never self-approve |
| `add_log` | Write trace/audit events | Automatic |
| `verify_run` | Check evidence before completion | Automatic |
| `run_clips_office` | Delegate safe internal draft clipping work | Automatic for demo/internal drafts |

## Agent 101 Studio execution registry

The Studio provider loop exposes 30 bounded tools. They are grouped here by authority; the runtime schema remains the exact source of truth.

| Group | Tools | Authority |
| --- | --- | --- |
| Project read | `read_file`, `search_project_text`, `list_files`, `inspect_project_workspace` | Automatic inside the allowlisted text workspace; secrets, runtime data, dependencies, builds, and symlink escapes are blocked |
| Output build | `write_file`, `scaffold_website`, `add_stripe_checkout`, `add_email_flow`, `generate_deployment_config` | New isolated outputs are automatic; replacement requires exact one-use approval unless it is a deterministic same-run builder transition |
| Business system | `create_business_blueprint`, `create_project_plan`, `create_handoff_doc`, `generate_brand_identity`, `write_product_listings`, `get_market_data` | Automatic drafts; assumptions and non-live market context must remain labeled |
| Paid/external | `write_copy`, `generate_product_image`, `generate_hero_image`, `generate_logo_concept`, `search_web`, `analyze_competitor` | Exact Human Gate scope; paid model/image calls also reserve monthly budget before dispatch |
| Consequential local | `delete_file`, `run_shell`, `capcut_edit_clip` | Exact Human Gate or the stricter CapCut practice/export controls; approvals are consumed once |
| Project self-edit | `propose_project_edit`, `apply_project_edit` | Proposal is automatic; apply requires matching hash-locked Human Gate approval and trusted validation |
| Governance | `request_human_approval`, `check_approval_status`, `configure_studio_layout`, `verify_output_project` | Approval requests/status and reversible layout are automatic; untrusted executable boot requires critical fingerprint approval |

## Not Configured Yet

| Tool | Reason |
| --- | --- |
| `render_clip` | Requires verified media workspace and render pipeline |
| `start_browser_session` | External browser automation needs explicit Human Gate and connector policy |
| Real TikTok/Instagram/YouTube posting | Public publishing is intentionally blocked |
| Social OAuth/account connection | Connector activation requires Human Gate |

## Evidence Contract

Every meaningful tool result must include at least one of:

- record ID,
- artifact ID,
- approval ID,
- provider response,
- file path,
- log/trace ID,
- explicit failure message.

No tool may report success without evidence.
