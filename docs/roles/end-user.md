# Console and CLI user

You do the day's work on the platform through its two clients: the web console and the `platformctl` command line. Both ask the services and show what they answer; neither decides anything on its own, so when one of them refuses, the reason comes from a service. This page points you to the help for each task.

## Start here

| If you work in | Read |
| --- | --- |
| The browser | [Console overview](../console/README.md), then the [Console user guide](../console/user-guide.md) |
| A terminal | [CLI overview](../cli/README.md), then [CLI usage](../cli/usage.md) |

New to the vocabulary? [Concepts](../platform/concepts.md) explains tenants, workspaces, collections, records and grants.

## Everyday tasks

| Task | In the console | With the CLI |
| --- | --- | --- |
| Sign in and out | [Sign in and out](../console/user-guide.md#sign-in-and-out) | [Sign in](../cli/usage.md#sign-in) |
| Find a workspace and browse its records | [Find a workspace](../console/user-guide.md#find-a-workspace), [Browse records](../console/user-guide.md#browse-records) | [Everyday work](../cli/usage.md#everyday-work) |
| Create or edit a record | [Create and edit a record](../console/user-guide.md#create-and-edit-a-record) | `data items create`, `data items update` ([CLI spec §5.6](../cli/spec.md#56-data)) |
| See a record's history, or roll it back | [Use history and rollback](../console/user-guide.md#use-history-and-rollback) | `data items versions`, `data items rollback` ([CLI spec §5.6](../cli/spec.md#56-data)) |
| Read a workspace's audit | [Change the data model and read the audit](../console/user-guide.md#change-the-data-model-and-read-the-audit) | `data audit` ([CLI spec §5.6](../cli/spec.md#56-data)) |
| Check service status | [Read service status](../console/user-guide.md#read-service-status) | `status`, `doctor` ([CLI spec §5.1](../cli/spec.md#51-root-commands)) |
| Read these docs | [Use the built-in docs](../console/user-guide.md#use-the-built-in-docs) | — |

## Operator tasks

If you hold an operator scope, you also administer tenants. The step-by-step guides cover the whole job; the console and the CLI are two ways to do each step.

| Task | Guide | In the console |
| --- | --- | --- |
| Grant or revoke access, manage groups and roles | [Manage access](../guides/manage-access.md) | [Administer a tenant](../console/user-guide.md#administer-a-tenant) |
| Bring a new tenant on | [Onboard a tenant](../guides/onboard-a-tenant.md) | [Administer a tenant](../console/user-guide.md#administer-a-tenant) |
| Understand what your operator scope lets you do | [Console spec §4](../console/spec.md#4-operator-scope) | — |

## When something refuses

| What happened | Where to look |
| --- | --- |
| The CLI refuses a command or exits with an error status | [CLI usage: when something refuses](../cli/usage.md#when-something-refuses), [CLI spec §6](../cli/spec.md#6-output) |
| A record cannot be read or saved | [Data troubleshooting](../data/troubleshooting.md) |
| Sign-in fails | [Access troubleshooting: failed logins](../access/troubleshooting.md#failed-logins) |
| Any other error from a request | [Troubleshoot a request](../guides/troubleshoot-a-request.md) |
| The console hides an action you expected | [Console spec §5](../console/spec.md#5-ability) |
