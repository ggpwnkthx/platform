# The interface of the operator

`platformctl tui` draws the deployments of your machine and what they answer. It is the same client of the same services as the commands: the interface asks Access for the tenants, the principals and the grants, and the gateway for the state of its services, and it draws what they answer. It holds no policy of its own, and it decides nothing that a command does not decide.

```bash
platformctl tui
```

The interface needs a terminal. A machine that has none — a pipeline, a cron job, a container — runs the commands of the [usage](usage.md#everyday-work) and not the interface.

## The pages

| Page | What it shows |
| --- | --- |
| Deployments | The profiles of your machine: the addresses of the gateway, of Access, the workspace and the tenant of each. |
| A deployment | The probes of the services of the deployment, and the addresses it is reached under. |
| Tenants | The tenants of the deployment, with their counts, and the form that writes one. |
| Principals | The principals of the deployment, or of the tenant you came from, and the form that registers one. |
| Grants | The grants of the deployment, of the tenant or of the principal you came from, the form that gives one, and the revocation of a grant. |
| A new deployment | The questions of the wizard of the deployment, and the log of the deployment itself. |

The page of the deployments is the one the interface opens on. The reader goes from it to the tenants, to the principals and to the grants of the deployment they have selected, and back again.

## The keys

| Key | What it does |
| --- | --- |
| `↑` `↓`, `k` `j` | Move the selection. |
| `pgup` `pgdn`, `home` `end` | Move the selection by a page, and to the first and the last row. |
| `/` | Filters the list with the text you type. `enter` keeps the filter, `esc` clears it. |
| `enter` | Opens the selected deployment, or the form of the selected tenant. |
| `n` | Creates: a deployment, a tenant, a principal or a grant, according to the page. |
| `a` | Applies the deployment that is selected again: it opens the form of that deployment with its answers and with the images of the release, and the deployment is applied when you send the form and confirm it. |
| `e` | Edits the profile or the tenant that is selected. |
| `c` | Makes the selected profile the one of the machine. |
| `d` | Removes the selected profile, or revokes the selected grant. The interface asks before it writes. |
| `r` | Reads the page again. The pages of a deployment read themselves every five seconds. |
| `t` `p` `g` | The tenants, the principals and the grants. On a tenant, `p` and `g` are its principals and its grants; on a principal, `g` is its grants. From the deployments they are the ones of the whole deployment. |
| `esc` | Clears the filter, or goes back up the way you came down. |
| `?` | The keys of the interface. |
| `q` | Quits. `ctrl` and `c` together quit as well. |

The page of the deployments works on the deployment that is selected: the tenants, the principals, the grants and the probes you open are the ones of the row you are on, and the header names it. The line above the keys says what the interface has to say — a message, a question, the text of the filter — and where you are in the list.

In a form:

| Key | What it does |
| --- | --- |
| `tab`, `↓` | The next field. `shift` and `tab` together, and `↑`, are the field before. |
| `←` `→` | Move in the value of a field that holds a text, and change the value of a field that holds a choice. The arrows stop at the ends of the list; the space goes round it. |
| `home` `end` | The beginning and the end of the value. |
| `backspace` `delete` | Erase the letter before and after the cursor. `ctrl` and `u` together erase the value. |
| `space` | Changes the value of the field: the next choice of a list, or the other side of a yes or a no. In a field that holds a text it is a letter. |
| `enter` | Sends the form. The creation of a deployment asks before it begins, and an answer that is not the shape the deployment needs puts you in its field. |
| `esc` | Leaves the form. A form you wrote in asks before it is left. |

The form says under its fields what the field you are in is: its whole label, what you should know about it and the values it takes. The secrets of a tenant are written and never drawn.

### A principal and its grants

The short way from a tenant to a principal that may do something:

1. On the tenants, select the tenant and press `p`: the page is the principals of that tenant.
2. Press `n`. The form already holds the tenant; type the subject the provider of the tenant calls the account by, its address and its name, and press `enter`.
3. The interface says that the principal holds no grant yet and asks whether to give it one. Press `y`: the page is the grants of that principal, and the form of a grant is open with the tenant, the principal and the workspace of the profile filled in.
4. Type the permission and the route — or take what the form offers — and press `enter`.

To give a grant to a principal that is already there, select it on the principals and press `g`, then `n`.

A field of these forms offers what the interface knows: the tenants of the deployment, the principals of the tenant by their address, and the permissions, the workspaces, the routes and the operators that the grants it has read already name. The offer is drawn after what you typed and named under the fields; `→` at the end of the value takes it, and typing goes on with something else. A field takes any text: the offer is a shortcut and not a list of what is allowed. You name the principal of a grant by its address and the grant is written with its identifier, and the list of the grants shows the addresses.

The forms give a permission to a principal. A grant of a role, or to a group, is given with `platformctl access grants put`.

A question of the interface is answered by `y` or by `n`: a key that is neither leaves the question where it is.

## The credentials

The interface reads the credentials of the shell and not the profiles, exactly like the commands do:

| Credential | Variable | What it opens |
| --- | --- | --- |
| The administration of Access | `PLATFORMCTL_ADMIN_TOKEN` | The tenants, the principals and the grants. |
| The control plane of the gateway | `PLATFORMCTL_CONTROL_TOKEN` | The route table of the gateway. |
| The caller | `PLATFORMCTL_TOKEN`, or the credential of a login | The records of a workspace. |

The credential of the administration is one the deployment creates, and the state of the deployment holds it. When your shell holds no `PLATFORMCTL_ADMIN_TOKEN`, the interface reads the credential in the state of the deployment the first time a page needs it — the tenants, the principals or the grants — and keeps it while it runs. It writes it nowhere and it never draws it, and the credential of your shell comes first when there is one.

The reading needs what the wizard left on your machine: the files of the deployment next to the templates (`deploy/tofu/runtime/<environment>`), the tool that writes the infrastructure, and a session of the cloud that may read the state. The deployment of a profile is the one whose name — its prefix and its environment — or whose address of Access is the one of the profile. The templates are initialized against one deployment at a time, the one that was deployed last: the interface checks the address of Access the templates answer against the profile, and it does not send the credential of one deployment to another. A deployment that was written from another machine has no files here, and its credential comes from your shell.

A page whose credential is missing says why it could not be read and which variable names it, and the other pages keep working.

## What it writes

| What | Where |
| --- | --- |
| A profile | The file of the profiles, `platformctl context paths` shows where it is. |
| A tenant, a principal, a grant | Access, through its administration. |
| A deployment | The state of the deployment, through the wizard of the CLI, and the profile of the deployment when it is applied. |

The form of a new deployment holds the answers the wizard finds by itself, and you confirm them or change them: the digests of the images of the latest release of the platform, the digest of the image of the client of PostgreSQL, the range of the public address of your machine, and the answers of the deployment of the environment when there is one already. They are read while you fill in the form, and they are written in the fields you did not write in. What cannot be read is said in the log, and its field is yours to fill in. A deployment whose digests you left to the release runs that release, and the question the interface asks before it begins names it.

A deployment that is applied is written as a profile of your machine, so the interface works on it at once: the profile is named after the prefix and the environment of the deployment (`platform-development`), it holds the public addresses of the gateway and of Access and the workspace, and it becomes the current one when the machine has none. `esc` goes back to the deployments, on the new one. The form opens on the answers of the deployment you wrote last.

A deployment that is already there is applied again by its environment: select it on the deployments and press `a`. The form opens with the answers of that deployment and with the images of the latest release, the question the interface asks before it begins names the release, and the wizard applies it. A deployment your machine holds no files of cannot be applied again — there are no answers of it to apply — and the interface says so; name its environment in the form of a new deployment instead.

When your session of Azure holds more than one subscription, the first field of the form asks which one the deployment is written in. It holds the subscription your session works in until you choose another, and the question the interface asks before the deployment begins names it. The deployment itself runs where nobody can answer a question, so sign in to Azure (`az login`) before you open the form: the log says so when the machine holds no session.

The creation of a deployment is the wizard of the CLI and not a second wizard: the interface collects the answers of the operator, writes them in a file of answers and runs `platformctl deploy` with it. The words of the wizard are the log of the interface, and the deployment is applied with the plan the wizard shows. The operator signs in to the cloud of the provider before the interface runs it, and the wizard asks the cloud for the subscription it uses when the operator holds more than one.

A deployment takes minutes, and the interface says so while it takes them: the line above the keys names the work the interface is at — the answers of a deployment, the deployment itself — and how long it has been going on, and the frame is drawn again while the work goes on. The words of the wizard that come after the apply are in the log too: the binding of the certificates of the public names, the job of the migration of the schema and the wait for Access to come up are said as they happen, and a reader who waits is never left with a screen that does not move and says nothing.

## What it does not do

The interface is a reader and a writer of the things the commands write. It does not sign anybody in, it does not hold the credential of the caller in the terminal, it writes no credential anywhere, and it leaves no state of its own: the only files it touches are the file of the profiles and the file of the answers of a deployment, and both are files the commands touch as well.
