---
name: maestro-azure-devops
description: Guide Maestro's Azure Boards and Repos task/PR identity and connection requirements while identifying Orchestra's currently unavailable Azure DevOps tracker operations.
---

# Azure DevOps for Maestro

Read `maestro-integrations`. Keep Azure organization, project, work item numeric ID, repository ID, and PR ID distinct from Orchestra project/task/workspace IDs. Work item URLs and Repos PR URLs identify different resources.

Orchestra currently has no Azure DevOps tracker adapter in its adapter factory. This skill does not add an account connection or enable issue/task commands. Do not silently route Azure work to GitHub/SQLite, select a different tracker, or report Azure Boards tasks as synchronized. Record the missing capability explicitly in the user's journey.

If an Azure tool or CLI is actually available and the user has authorized its use, validate its organization/project scope and read access before reporting access. Authentication setup belongs in the account/connection flow, never in skill text. Inspect tool help and use the installed version; this skill does not advertise Azure CLI commands that Orchestra has not provided.

The implementation journey is: configure a verified Azure connection, discover exact project/work item identity and process-specific states, provide source-scoped observation/create/assignment with durable receipts, preserve work item revision checks, bind a local execution/workspace separately, attach the exact Repos/GitHub PR URL, then verify review/head/checks before task-state reconciliation. These adapter and reconciliation steps remain unavailable until implemented and behaviorally verified.

For an existing local Orchestra task with Azure PR linkage, preserve the stored PR URL and identify the repository provider without claiming the task originated in Boards. No PR link means no observed linkage.

Primary reference: [Azure DevOps Work Items API](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1). Provider API documentation is a design input, not proof of a working Orchestra integration.
