# CLAUDE.md

The agent instructions for this repo live in [AGENTS.md](AGENTS.md), one file
for every coding agent. Claude Code imports it here:

@AGENTS.md

Before every request: `git fetch` and bring in the latest `main`, then work
on a branch that is not `main`, save and push it as you go without being
asked, talk in plain words (no git jargon), and open a pull request to get
into `main` (only JollyGrin merges). Templates have names people can say;
the list is TEMPLATES.md. The full rules are at the top of AGENTS.md.
