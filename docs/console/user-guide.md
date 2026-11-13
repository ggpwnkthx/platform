# User guide

Task-by-task help for people who use the console: signing in, working with a workspace's records, administering a tenant as an operator, reading service status and using the built-in docs. For what each page calls behind the scenes, see the [specification](spec.md).

## Before you start

You need a browser and the console's address from whoever runs your deployment. What you can open depends on rights that Access holds for you:

| You want to | You need |
| --- | --- |
| Read or change records in a workspace | A right in that workspace, granted in Access; Data's policies decide what each right allows |
| Administer your tenant | The `console.admin` key, held on the tenant itself: an operator of your tenant makes you an administrator ([Administer a tenant](#administer-a-tenant)) |
| Administer every tenant | The `console.platform` key, which only an operator of the platform gives |
| See versions, latencies and probe answers on the status page | The `console.status` key |

The documentation and the basic status page need no sign-in at all.

Once you are signed in, the page header names your tenant under your name, and adds **operator** or **platform operator** when you administer something.

## Sign in and out

1. Open the console and choose **Sign in**, or open any page that needs a session; the console sends you to sign in and brings you back afterwards.
2. Sign in at your tenant's identity provider. If you are already signed in there, this step may pass without a prompt.
3. Check **You** (`/me`) to see your name, e-mail, principal ID, tenant, the console keys you hold and the roles your sign-in token carried.

To sign out, choose **Sign out** in the page header. Your session also ends on its own after 8 hours without use or 24 hours in total (the deployment can change both).

Your access to data is shorter-lived than your session: the badge in the page header counts down your **data access**. The console renews it for you before it runs out, so you read the data for as long as your session lasts. When the console cannot renew it, the badge turns into **renew data access**: choose it to sign in again, and the workspaces you had opened stay listed. If a form was sent after your data access expired, nothing was changed: send it again.

A sign-in that was begun in another browser, or more than ten minutes ago, cannot complete. Start a new one.

## Find a workspace

1. Open **Workspaces**. The list shows the workspaces your rights name plus any you opened in this session, and marks each as open or refused by Data.
2. To open a workspace that is not listed, paste its ID (a UUID such as `11111111-1111-4111-8111-111111111111`) under **Open a workspace** and choose **Open**.

You must open a workspace by ID when one of your rights covers every workspace in your tenant (such a right names no workspace to list), or when the console could not read your rights. The list checks at most 24 workspaces.

The workspace page lists the collections Data opens to you and what you may do with each.

## Create a workspace

If your tenant gave you the right `data.workspace.create`, the **Workspaces** page offers **New workspace**. The form asks for two things:

| Field | What it is |
| --- | --- |
| Slug | The name of the workspace inside your tenant: letters, digits, dashes and underscores, starting with a letter. It never changes, and no two workspaces of a tenant share it. |
| Name | The name people read. |

Choose **Create the workspace** and the console takes you to it. Two things happen: Data registers the workspace under your tenant, and Access gives you the administration of it — the role `admin` of your tenant, granted on that workspace — so you may read and change its model, its audit and its records.

A slug that your tenant already holds is refused, and the form says so. Without the right, **New workspace** is drawn disabled and says what is missing; a call that asks for the creation anyway is refused.

## See what you may do

Open the **Your access** tab of a workspace. Each collection has a grid: the rows are its records and each of its fields, the columns are read, create, change and delete. Every "no" carries a numbered note with its reason. Beside the grids, **Beyond the records** says whether you may read the data model, change it and read the audit, and **Your permissions here** lists the permissions Access gives you on the workspace, each with what it opens when the console knows. A "yes" is the most you may do: Data still checks each record.

Elsewhere, the console draws what you may not do instead of leaving it out:

| You see | It means |
| --- | --- |
| A greyed button with a lock | An action you may not take. Hover over it or move to it with the keyboard to read why, and who can change it. |
| A tab with a lock | The **Data model** or the **Audit** of the workspace needs a permission you do not hold there. The tab still opens, and its page names the permission. |
| A dashed mark beside a collection | One of read, create, change and delete that Data's policies refuse you in that collection. Point at it to read why. |
| A read-only field in a form | A field you may read but not change, with its reason. |

A place you cannot reach at all, such as **Operators** without an operator key, is not linked in the page header.

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

With `data.model.read` alone you read the model, and the page shows none of the forms that change it. An operator of your tenant grants these permissions on the workspace, or on every workspace of the tenant.

## Administer a tenant

Open **Operators**. Platform operators see every tenant and can create one; an operator of a single tenant goes straight to it. Each tenant has these pages:

| Page | What you do there |
| --- | --- |
| Tenant | Start here. **Manage access** leads to the tasks below, and **Administrators** lists who opens this administration, and through which right. Under them: counts and recent changes, and the tenant's settings. The tenant names the provider its people sign in at, and the provider is the tenant's own: name another issuer, another client and another secret and the tenant signs in there from then on. Leave the secret of the provider empty to keep the one the tenant has, and leave the secret of the client empty to keep the one it has. Two flags say who signs in: **Registers unknown people** creates a principal for every identity that signs in, and **The first one administers the tenant** gives the administration of the tenant to the first of them — it may then add the users and the rights of the tenant. Registering a provider offers the **presets** the platform supports: pick one and the issuer, the scopes and the algorithms are filled with it, and the steps of the registration of the client of Access at the vendor are shown. Every field stays yours. |
| Users | See what each user holds: an **administrator** mark, their roles, and how many single permissions and groups. Filter by exact e-mail and status. Register one user by provider identity, e-mail and name, or register a team: one user per line as `identity, e-mail, name`, at most 1 000 lines; a failing line does not stop the others. |
| Routes | Register the routes of the tenant: a domain of addresses, or one address of its own, names the tenant of a login and the provider the callers of it sign in at. A route routes nothing until it is proved: the owner of the domain publishes the record the row names — a TXT record of `_access` of the domain, carrying the challenge — and **Check the record** proves it; a platform operator may also **Vouch for it** instead. |
| A user | Everything about one person: what they can do in effect, what the console opens to them, their rights, their groups, and their registration. The tasks below start here. |
| Groups | Create a group by key and name, then add members. A right granted to a group is held by every member. |
| A group | Search and add members; the page marks changes that are not saved yet and asks before you leave with them. Grant and revoke the group's rights; rename it. |
| Rights | Every right of the tenant: what it gives, who holds it, where it holds and until when. Filter by holder, by what a right gives and by place; switch between live, revoked or ended, and all. Grant a right, or revoke one. |
| Roles | List roles with the permissions they hold in effect, the roles they include and how many live grants name them, or switch to **Permissions by role** to change several roles in one grid. Create a role. Every tenant has one: **admin**, the role of the administrators of the tenant. It holds the right to open the administration of the tenant, the detail of the status of the services, and the capabilities that administer a workspace — its model and its audit. |
| A role | Edit its name, description, permissions and included roles by adding and removing chips; see what it holds in effect, what each permission opens and who holds it; remove it once no grant and no role names it. |
| Audit | Every change to the tenant, newest first, filterable by action; export it as CSV or JSONL. |

Your operator keys are read again on every page. If someone revokes them, administration closes from your next page on.

### Give someone access

1. Open **Rights** and choose **Grant a right**. From the page of a user or of a group, **Grant a right to …** opens the same form with the holder already chosen.
2. Under **Who**, search for a user or a group.
3. Under **What**, choose a role, or switch to **Single permission** and search for one. A role lists the permissions it holds. A permission that no grant and no role of the tenant names is created only once you confirm it.
4. Under **Where**, choose the place the right holds in (the table below).
5. Under **Until**, choose when the right ends, or **Never**. Leave **Route** empty unless the right is for one route of the gateway.
6. Read the lines above **Grant**, then choose it.

| Place | Choose it for |
| --- | --- |
| **The tenant itself** | What the console reads: the administration of the tenant, the detail of the status, the creation of workspaces. |
| **All workspaces** | A right that holds on every workspace of the tenant, the ones created later too, and on the tenant itself. |
| **One workspace** | The records, the model and the audit of that workspace. Search for it by name, or paste its ID; Data names the workspaces it opens to you, and the others are listed by their ID. |

The lines above **Grant** say the right in words — who will hold what, where, until when — and what it opens there. They also name the permissions that open nothing in the place you chose: `console.admin` on one workspace administers nothing, and `data.model.read` on the tenant itself reads no model. Access accepts such a right all the same, which is why the form says it first. The console says this of its own keys and of the keys of Data it knows; what any other permission allows is decided by Data's policies.

To take a right back, choose **Revoke** on its row and confirm.

### Make someone an administrator

1. Open the user from **Users**.
2. Under **In the console**, choose **Make … an administrator** and confirm.

The console grants them the role `admin` on the tenant itself, with no end. The card then names the right that makes them an administrator, and the row of that right is marked **opens the administration**.

To take the administration back, revoke that right. The console tells you first when the right is your own, and when it is the only one that opens the administration to you: your next page would be a refusal.

### See what someone can do

Open the user. The page answers three questions:

| Card | Answers |
| --- | --- |
| **What … can do** | Every live permission with its roles expanded, where it comes from (directly, through a group, through a chain of roles) and where it holds. |
| **In the console** | What the console opens to them, asked of Access: the administration, the detail of the status, the creation of workspaces. A "no" names the key that is missing. |
| **Check access to a workspace** | What Access answers for one workspace and route right now — the answer the services act on — and the live rights that explain it. |

Change their groups under **Groups**: add or remove a group and choose **Save groups**. To find everyone who holds a permission, filter **Rights** by it under **Gives**: the list answers with the rights that give it, the grants of the roles that hold it among them.

### Change what roles hold

1. Open **Roles** and choose **Permissions by role**. The grid sets the roles of the tenant, one per column, against its permissions, one per row.
2. Tick a cell to give the permission to the role, and clear it to take it away. To add a permission the tenant does not name yet, type its key in the last row and tick the roles that hold it.
3. Choose **Save the changes**. The cells that are not saved yet are marked until you do, and **Discard** draws the grid again as it was.

A cell marked **via** is a permission the role holds through a role it includes: change it in the column of that role. A cell with a lock is closed to you, and says why when you point at it.

The console asks before a role is saved without the key that opens the administration: such a save closes the administration to everybody who holds the role, you among them when you hold it. The grid draws that cell closed; make the change on the page of the role, which names how many rights it touches and asks you to confirm.

### What only the platform does

Four things belong to an operator of the platform, and the console draws them closed, with the reason, to an operator of a tenant:

| What | An operator of a tenant |
| --- | --- |
| Giving `console.platform` | May not grant it, grant a role that holds it, put it in a role, make a role include one that holds it, or add a member to a group that gives it. The form names the permission and refuses to be sent. Such a group says why above its members, and its picker only takes members away; the page of a user names the group as not offered. |
| Creating a tenant | Goes straight to its own tenant. |
| The flags **Shared client** and **Default tenant** | Reads them, with a lock, in the tenant's form. |
| **Vouch for it** on a route | Sees the button disabled, and proves the route with the record of the domain instead. |

An operator of a tenant may still revoke any right of its tenant, `console.platform` included, and take anybody out of a group.

An operator of the platform who opens such a group is told that a new member is given `console.platform`, before they add one.

## Read service status

Open **Status** from the footer of any page. The status board shows whether the gateway, Access and Data are up and ready and refreshes every ten seconds; you can pause it. Operators holding `console.status` also see versions, latencies and probe answers.

Below the board, the **platform map** draws each participant in a request as a lane. Pick a request (a record, a sign-in, a grant change) to highlight the exchanges it makes, in order.

## Use the built-in docs

Open **Documentation** from the footer, or go to `/docs`. The home page asks which job you do: choose a role and the docs rearrange around it. The home shows your role's map (where to start, its tasks, its reference, what to do when something breaks), the sidebar leads with the same map, and previous and next walk your role's reading order. Every area stays one click away under **All documentation**, with maintainer pages collapsed. Each page names the roles that read it; pick one there, or use **Change role** in the sidebar, to switch. The console remembers your choice in this browser until you change it or pick **Everyone (no role)**. Each page has an outline, previous and next links, a link icon on each section heading, and copy buttons on code blocks. The theme switch in the page header cycles between Auto (follow the system), Light and Dark.
