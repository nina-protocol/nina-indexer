`Hubs` are a Nina primitive that creates a container around [Releases](/#tag/Releases), [Posts](/#tag/Posts).

`Hubs` have `Collaborators`:
- `Collaborators` are [Accounts](/#tag/Accounts) that have varying permissions on the `Hub`. 
- Permissions are as follows:
  - `canAddHubContent`  (`boolean`)
  - `canAddHubCollaborators` (`boolean`)
  - `allowance` (`integer`) -
    - `allowance` sets the amount of actions a `collaborator` can execute on on a `hub`. A value of `-1` translates to an unlimited allowance.
