import { Octokit } from '@octokit/core'
import { paginateRest } from '@octokit/plugin-paginate-rest'
import core from '@actions/core'
import fetch from 'node-fetch'

// INPUTS ---

const { GITHUB_REPOSITORY, GH_PAT: auth } = process.env
const [owner, repository] = GITHUB_REPOSITORY.split('/')

const email = core.getInput('EMAIL', { required: true })
const targetTopics = core.getInput('TOPICS', { required: true }).split('\n').sort()
const repo = core.getInput('REPOSITORY') || repository
const username = core.getInput('USERNAME') || owner

// GitHub API ---

// Octokit instance with paginate plugin
const octokit = new (Octokit.plugin(paginateRest))({
  auth,
  request: { fetch },
})

// Lists public repositories for the specified user
const getRepos = () =>
  octokit.paginate(`GET /users/${username}/repos`, {
    username,
    headers: { 'X-GitHub-Api-Version': '2022-11-28' },
  })

// Replaces an existing file in a repository
function updateFile(path, content, sha, message = 'updated readme topics') {
  return octokit.request(`PUT /repos/${owner}/${repo}/contents/${path}`, {
    owner,
    repo,
    path,
    message,
    committer: { name: username, email },
    content: Buffer.from(content).toString('base64'),
    sha,
    headers: { 'X-GitHub-Api-Version': '2022-11-28' },
  })
}

// Gets the contents of a file in a repository
async function getFile(path, contentType = 'json') {
  const {
    data: { sha, content },
  } = await octokit.request(`GET /repos/${owner}/${repo}/contents/${path}`, {
    owner,
    repo,
    path,
    headers: {
      'X-GitHub-Api-Version': '2022-11-28',
      Accept: `application/vnd.github.${contentType}`,
    },
  })
  return {
    sha,
    content: Buffer.from(content, 'base64').toString(),
  }
}

// Reducers ---

// Reduce to produce a map of topics with their respective repos
// eg; { "TOPIC_A": [ {repo_a}, {repo_b}, ... ], ... },
const reduceRepos = repos => {
  const reduced = repos
    .filter(x => x.fork === false && x.archived === false)
    .reduce(
      (acc, cur) => {
        const { name, topics, language, description: desc, stargazers_count: stars, pushed_at: update } = cur

        const topic = topics.find(x => targetTopics.includes(x))

        if (topic) acc[topic].push({ name, desc, stars, language, update })

        return acc
      },
      targetTopics.reduce((acc, cur) => ({ ...acc, [cur]: [] }), {})
    )

  return targetTopics.reduce(
    (acc, cur) => ({
      ...acc,
      [cur]: reduced[cur].sort((a, b) => b.stars - a.stars),
    }),
    {}
  )
}

const MONTH_MILLISECONDS = 1_000 * 60 * 60 * 24 * 30

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

// Get relative months passed since date
const getRelativeTimeDiff = date =>
  RTF.format(Math.round((new Date(date).getTime() - new Date().getTime()) / MONTH_MILLISECONDS), 'month')

// Reduce to produce the modified changes to be inserted later
const generateChanges = outcome =>
  targetTopics.reduce(
    (acc, cur) => {
      acc.push('', `### ${cur.toUpperCase()}`, '')

      acc.push('| Name  | Description | Stars | Language | Update |')
      acc.push('| ----- | ----------- | ----- | -------- | ------ |')

      outcome[cur].forEach(({ name, desc, stars, language, update }) => {
        const link = `[${name}](https://github.com/${owner}/${name})`
        const ago = getRelativeTimeDiff(update)
        acc.push(`| ${link} | ${desc} | ${stars} | ${language} | ${ago} |`)
      })

      return acc
    },
    ['', '## Topics', '']
  )

// Takes original lines and modified lines and merge them
const mergeChanges = (original, modifiedLines) =>
  original
    .split('\n')
    .reduce(
      (acc, cur, i, arr) => {
        if (cur === '<!--START_SECTION:topics-->') acc.replace = true

        if (cur === '<!--END_SECTION:topics-->') acc.replace = false

        if (acc.replace === false) acc.modified.push(cur)

        if (acc.replace === true && acc.done === false) {
          acc.modified.push(cur)
          modifiedLines.forEach(x => acc.modified.push(x))
          acc.done = true
        }

        if (i === arr.length - 1) return acc.modified

        return acc
      },
      { modified: [], replace: false, done: false }
    )
    .join('\n')

// ---

// Driver
async function run() {
  try {
    console.log('>> inputs:', { username, email, owner, repo, targetTopics })

    const repos = await getRepos()
    console.log(' ==> found', repos.length, 'repos')

    const outcome = reduceRepos(repos)

    const modifiedLines = generateChanges(outcome)

    const { sha, content } = await getFile('README.md')

    const modified = mergeChanges(content, modifiedLines)

    if (content !== modified) {
      core.info('Change detected. saving...')
      await updateFile('README.md', modified, sha)
    } else core.info('Everything up-to-date, Nothing to do.')

    core.info('Done ✓')
  } catch (error) {
    console.error(error)
    core.setFailed(error.message)
  }
}

run()
