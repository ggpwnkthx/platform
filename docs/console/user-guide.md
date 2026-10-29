# User guide

Task-by-task help for people who use the console: signing in, working with a workspace's records, administering a tenant as an operator, reading service status and using the built-in docs. For what each page calls behind the scenes, see the [specification](spec.md).

## Before you start

You need a browser and the console's address from whoever runs your deployment. What you can open depends on rights that Access holds for you:

| You want to | You need |
| --- | --- |
| Read or change records in a workspace | A right in that workspace, granted in Access; Data's policies decide what each right allows |
| Administer your tenant | The `console.admin` key on the console's route |
| Administer every tenant | The `console.platform` key |
| See versions, latencies and probe answers on the status page | The `console.status` key |

The documentation and the basic status page need no sign-in at all.

## Sign in and out

1. Open the console and choose **Sign in**, or open any page that needs a session; the console sends you to sign in and brings you back afterwards.
2. Sign in at your tenant's identity provider. If you are already signed in there, this step may pass without a prompt.
3. Check **You** (`/me`) to see your name, e-mail, principal ID, tenant, the console keys you hold and the roles your sign-in token carried.

To sign out, choose **Sign out** in the page header. Your session also ends on its own after 8 hours without use or 24 hours in total (the deployment can change both).

Your access to data is shorter-lived than your session: the badge in the page header counts down your **data access** and turns into **renew data access** when it runs out. Choose it to renew; the provider usually answers without asking you again, and the workspaces you had opened stay listed. If a form was sent after your data access expired, nothing was changed: send it again.

A sign-in that was begun in another browser, or more than ten minutes ago, cannot complete. Start a new one.

## Find a workspace

1. Open **Workspaces**. The list shows the workspaces your rights name plus any you opened in this session, and marks each as open or refused by Data.
2. To open a workspace that is not listed, paste its ID (a UUID such as `11111111-1111-4111-8111-111111111111`) under **Open a workspace** and choose **Open**.

You must open a workspace by ID when one of your rights covers every workspace in your tenant (such a right names no workspace to list), or when the console could not read your rights. The list checks at most 24 workspaces.

The workspace page lists the collections Data opens to you and what you may do with each.

## Browse records

Open a collection to see its records, then narrow the list:

| Control | Effect |
| --- | --- |
| Search | Records whose text matches. |
| Filter | Rows of field, operator and value, joined with "and". Operators: is, is not, `>`, `≥`, `<`, `≤`, is one of, is none of, is empty. For "or", "not" or nesting, write the filter as JSON instead. |
| Sort | Any filterable field, ascending or descending; the default is the identifier. |
| Per page | The page size. Pages are cursor-based, so use the next and previous links rather than page numbers. |
| Count | Also return the total number of matching records. |

Choose **Apply** to run the query and **Reset** to clear it. The filter grammar is Data's: see the [Data spec: query parameters and filters](../data/spec.md#93-query-parameters-and-filters).

If a collection says it is write only for you, the policies let you create records in it but not read them.

To group and summarize records, open the collection's aggregate view: group by up to three fields, then count and measure each group. A long answer shows only the first groups.

## Create and edit a record

To create a record:

1. In the collection, choose to add a new record.
2. Fill in the fields. Fields you leave empty get Data's default, or are refused if Data requires them.
3. Submit. Sending the same form twice creates only one record; the console tells you when that happened.

To change a record:

1. Open the record, edit the form and save. The console sends only the fields you changed; if you changed nothing, nothing is sent.
2. On success, the record is saved as a new version and the page names its number.

If someone else changed the record after you opened it, Data refuses the save. The page then shows the refusal next to the current version of the record: review it and make your change again.

To delete a record, use **Delete** on the record page and confirm. The console asks for confirmation on every irreversible action.

When Data refuses anything, the page shows its status, code, message, the fields involved and the request ID. Give the request ID to your operator when you report a problem.

## Use history and rollback

1. On the record page, open **History** to list its versions.
2. Open a version to see it beside the current record.
3. To restore it, roll back and confirm. The record takes that version's values again as a new version, so the history keeps every step.

The history of a deleted record is kept, and its versions are marked as deleted.

## Change the data model and read the audit

If Data's policies allow it (`data.model.read`, `data.model.write`), the workspace's **model** page shows its collections, fields, rules and relations and lets you change them. The **audit** page (`data.audit.read`) lists the mutations committed in the workspace.

## Administer a tenant

Open **Operators**. Platform operators see every tenant and can create one; an operator of a single tenant goes straight to it. Each tenant has these pages:

| Page | What you do there |
| --- | --- |
| Tenant | See counts and recent changes; edit the tenant's settings. |
| Users | Filter by exact e-mail and status. Register one user by provider identity, e-mail and name, or register a team: one user per line as `identity, e-mail, name`, at most 1 000 lines; a failing line does not stop the others. |
| A user | See the user's rights, both direct and through groups, live or also revoked and expired; their groups; edit or disable their registration. |
| Groups | Create a group by key and name, then add members. A right granted to a group is held by every member. |
| Rights | List every right, live or revoked/expired. Grant a permission or role on a workspace and route to a user or group, optionally with an expiry; revoke a right. |
| Roles | Save a role: a key, a name, its permissions and the roles it includes. Grant roles on the Rights page. |
| Audit | Every change to the tenant, newest first, filterable by action; export it as CSV or JSONL. |

Your operator keys are read again on every page. If someone revokes them, administration closes from your next page on.

## Read service status

Open **Status** from the footer of any page. The status board shows whether the gateway, Access and Data are up and ready and refreshes every ten seconds; you can pause it. Operators holding `console.status` also see versions, latencies and probe answers.

Below the board, the **platform map** draws each participant in a request as a lane. Pick a request (a record, a sign-in, a grant change) to highlight the exchanges it makes, in order.

## Use the built-in docs

Open **Documentation** from the footer, or go to `/docs`. The home page asks which job you do: choose a role and the docs rearrange around it. The home shows your role's map (where to start, its tasks, its reference, what to do when something breaks), the sidebar leads with the same map, and previous and next walk your role's reading order. Every area stays one click away under **All documentation**, with maintainer pages collapsed. Each page names the roles that read it; pick one there, or use **Change role** in the sidebar, to switch. The console remembers your choice in this browser until you change it or pick **Everyone (no role)**. Each page has an outline, previous and next links, a link icon on each section heading, and copy buttons on code blocks. The theme switch in the page header cycles between Auto (follow the system), Light and Dark.
