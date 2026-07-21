# Contributing to Pricing Intelligence

## Style Guides

### Git Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#specification) specification to write commit messages.

The following commit types are defined:
- `feat`: Use this type if you are adding features, changing code behavior or deleting functionality, etc...
- `fix`: Use this type if you are correcting bugs.
- `docs`: Use this type if you are changing any type of documentation.
- `refactor`: Use this type if you are refactoring code (i.e., not changing the behaviour of a feature).
- `chore`: Use this type if you are correcting typos, adding new line characters to files, deleting unnecessary files, etc...

> [!IMPORTANT]
> Each commit should contain the smallest possible set of changes. If a change spans multiple
> types, stage fewer files and split it into smaller separate commits.

Here are some valid git commit messages examples:
```txt
feat: enforce commit style conventions
fix: infinite call to permissions in pricings tab
refactor: order when navigating on user menu
chore: deactivated harvey chat in pricing card
```

To enforce these commit conventions we are using [Husky](https://typicode.github.io/husky/) with [commitlint](https://commitlint.js.org/). You will not
be able to commit if you write an invalid commit message; the tool will display an error in that situation.

> [!NOTE]
> If you want to bypass git commit hooks (commit-msg) you can pass --no-verify or -n option to `git commit`, i.e, `git commit -m "feat: add some module" -n`.
