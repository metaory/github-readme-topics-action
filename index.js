import { readFile, writeFile } from "node:fs/promises";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import core from "@actions/core";
import fetch from "node-fetch";

// XXX: Boolean(process.env['CI']) // check if running in a Github Action workflow

const [, , mode] = process.argv;

const MONTH_MILLISECONDS = 1_000 * 60 * 60 * 24 * 30;
const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const { GITHUB_REPOSITORY, GH_PAT: auth } = process.env;
const [OWNER, REPOSITORY] = GITHUB_REPOSITORY.split("/");

const email = core.getInput("EMAIL", { required: true });
const targetTopics = core.getInput("TOPICS", { required: true }).split("\n");
const repo = core.getInput("REPOSITORY") || REPOSITORY;
const username = core.getInput("USERNAME") || OWNER;
const owner = OWNER;

const octokit = new (Octokit.plugin(paginateRest))({
  auth,
  request: { fetch },
});

// const write = (data, path) =>
//   mode === "dev" &&
//   writeFile(
//     path,
//     typeof data === "object" ? JSON.stringify(data, null, 2) : data
//   );

// const read = async (path) =>
//   JSON.parse(await readFile(path, { encoding: "utf8" }));

function updateFile(path, content, sha, message = "updated readme topics") {
  return octokit.request(`PUT /repos/${owner}/${repo}/contents/${path}`, {
    owner,
    repo,
    path,
    message,
    committer: {
      name: username,
      email,
    },
    content: Buffer.from(content).toString("base64"),
    sha,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}
async function getFile(path, contentType = "json") {
  const {
    data: { sha, content },
  } = await octokit.request(`GET /repos/${owner}/${repo}/contents/${path}`, {
    owner,
    repo,
    path,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
      Accept: `application/vnd.github.${contentType}`,
    },
  });
  return {
    sha,
    content: Buffer.from(content, "base64").toString().split("\n"),
  };
}

const reduceRepos = (repos) => {
  const reduced = repos
    .filter((x) => x.fork === false)
    .reduce(
      (acc, cur) => {
        const {
          name,
          description: desc,
          topics,
          stargazers_count: stars,
          language,
          updated_at: update,
        } = cur;

        const { topic, match } = topics.reduce(
          (_acc, _cur) => {
            const topic = targetTopics.find((x) => x === _cur);
            if (topic && _acc.match === false) return { topic, match: true };
            return _acc;
          },
          { topic: null, match: false }
        );

        if (match)
          acc[topic].push({
            name,
            desc,
            stars,
            language,
            update,
          });

        return acc;
      },
      targetTopics.reduce((acc, cur) => ({ ...acc, [cur]: [] }), {})
    );

  return targetTopics.reduce((acc, cur) => {
    acc[cur] = reduced[cur].sort((a, b) => b.stars - a.stars);
    return acc;
  }, {});
};

const generateChanges = (outcome) =>
  targetTopics.reduce(
    (acc, cur) => {
      acc.push(...["", `# ${cur.toUpperCase()}`, ""]);

      acc.push("| Name  | Description | Stargazers | Language | Update |");
      acc.push("| ----- | ----------- | ---------- | -------- | ------ |");

      outcome[cur].forEach(({ name, desc, stars, language, update }) => {
        const link = `[${name}](https://github.com/${owner}/${name})`;
        const ago = RTF.format(
          Math.round(
            (new Date(update).getTime() - new Date().getTime()) /
              MONTH_MILLISECONDS
          ),
          "month"
        );
        acc.push(`| ${link} | ${desc} | ${stars} | ${language} | ${ago} |`);
      });

      return acc;
    },
    [""]
  );

const mergeChanges = (originalLines, modifiedLines) =>
  originalLines
    .reduce(
      (acc, cur, i, arr) => {
        if (cur === "<!--START_SECTION:topics-->") {
          acc.modified.push(cur);
          acc.replace = true;
          return acc;
        }

        if (cur === "<!--END_SECTION:topics-->") {
          acc.modified.push(cur);
          acc.replace = false;
          return acc;
        }

        if (acc.replace === false) acc.modified.push(cur);

        if (acc.replace === true && acc.done === false) {
          modifiedLines.forEach((x) => acc.modified.push(x));
          acc.done = true;
        }

        if (i === arr.length - 1) return acc.modified;

        return acc;
      },
      { modified: [], replace: false, done: false }
    )
    .join("\n");

const getRepos = () =>
  octokit.paginate(`GET /users/${username}/repos`, { username });

async function run() {
  try {
    core.warning(` ==> running mode: ${mode}`);

    console.log(">> inputs:", { username, email, owner, repo, targetTopics });

    const repos = await getRepos();
    console.log(" ==> found", repos.length, "repos");
    // await write(repos, "tmp/repos.json")

    const outcome = reduceRepos(repos);
    // write(outcome, "tmp/outcome.json");

    const modifiedLines = generateChanges(outcome);
    console.log("modifiedLines.length:", modifiedLines.length);

    const { sha, content } = await getFile("README.md");
    console.log("content.length:", content.length);

    const modified = mergeChanges(content, modifiedLines);
    console.log("modified.length:", modified.split("\n").length);
    // write(modified, "tmp/modified.md");

    await updateFile("README.md", modified, sha);
    core.info("updated README.md ✓");
  } catch (error) {
    console.error(error);
    core.setFailed(error.message);
  }
}

run();
