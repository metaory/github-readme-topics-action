# GitHub Profile Readme Topics Action

:pushpin: GitHub Action to update GitHub profile README.md with categorized repos based on their Topics

---

### Inputs

- `TOPICS`: list of topics to categorize repos by
- `EMAIL`: git user email address
- `USERNAME`: _OPTIONAL_; git username; defaults to repository owner
- `REPOSITORY`: _OPTIONAL_; the repository to update its readme; defaults to current repository

### Features

- Aggregates all user source repos (not forked or archived), and group them by specified provided Topics
- Sort results based on number of Stars
- Calculate relative time passed since last update
- Update the target repository README with the generated content

---

<p align="center">
  <img src="./assets/screenshot.png" width="600" />
</p>

---

## Instructions

- Add this comment somewhere in your `README.md`. You can find an example [here](https://github.com/metaory/metaory/blob/master/README.md?plain=1#L37).

```
<!--START_SECTION:topics-->
<!--END_SECTION:topics-->
```

- Create a workflow file.

`.github/workflows/readme-topics.yml`

```yml
name: readme-topics
run-name: Update README.md with repos categorized by topic
on:
  schedule:
    - cron: "0 0 * * 0"
  workflow_dispatch:
jobs:
  generate-topics:
    runs-on: ubuntu-latest
    steps:
      - uses: metaory/github-readme-topics-action@v1
        env:
          GH_PAT: ${{ secrets.GH_PAT }} # your personal-access-tokens with write permission
        with:
          # USERNAME: metaory # OPTIONAL; the committer username, defaults to repository owner (GITHUB_REPOSITORY_OWNER)
          # REPOSITORY: playground # OPTIONAL; the repository name to update its readme, defaults to current repository (GITHUB_REPOSITORY)
          EMAIL: metaory@gmail.com # REQUIRED; the committer email address
          TOPICS: |- # REQUIRED; list of topics to group by
            api
            automation
            challenge
            cli
            github-actions
            npm-package
            theme
```

The above job runs every one week, you can change it as you wish based on the [cron syntax](https://jasonet.co/posts/scheduled-actions/#the-cron-syntax).

---

## TODO

- [x] format relative date (update column)
- [x] add links (name column)
- [x] publish a tag release
