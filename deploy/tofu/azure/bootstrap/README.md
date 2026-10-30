# The place where the state of the deployment lives

The state of a deployment holds the value of every secret of the
deployment, so the state is a secret store. This stack creates the
store: an account of Azure Storage that is encrypted at rest, that keeps
the versions of the state, whose shared key is off, and that only the
addresses of the operator reach.

The stack runs once per deployment, before the first apply of the
templates of [`../`](../), and it is the only stack of the platform that
runs without a backend:

```bash
tofu -chdir=deploy/tofu/azure/bootstrap init
tofu -chdir=deploy/tofu/azure/bootstrap apply \
  -var name_prefix=platform -var environment=production \
  -var 'operator_addresses=["203.0.113.4/32"]'
```

The output `backend_config_hcl` is the configuration of the backend of
the deployment. Write it to the runtime directory of the deployment, as
`backend.hcl`:

```bash
mkdir -p deploy/tofu/runtime/production
tofu -chdir=deploy/tofu/azure/bootstrap output -raw backend_config_hcl \
  > deploy/tofu/runtime/production/backend.hcl
```

The state of **this** stack is local, and it holds the name of the
account of the state of the deployment. It is not committed, and the
directory of the tools is in `.gitignore`.
