import * as os from 'os'
import * as path from 'path'
import * as core from '@actions/core'
import * as artifact from '@actions/artifact'
import {Inputs, Outputs} from './constants'

const PARALLEL_DOWNLOADS = 5

export const chunk = <T>(arr: T[], n: number): T[][] =>
  arr.reduce((acc, cur, i) => {
    const index = Math.floor(i / n)
    acc[index] = [...(acc[index] || []), cur]
    return acc
  }, [] as T[][])

async function run(): Promise<void> {
  const inputs = {
    name: core.getInput(Inputs.Name, {required: false}),
    path: core.getInput(Inputs.Path, {required: false}),
    token: core.getInput(Inputs.GitHubToken, {required: false}),
    repository: core.getInput(Inputs.Repository, {required: false}),
    runID: parseInt(core.getInput(Inputs.RunID, {required: false}))
  }

  if (!inputs.path) {
    inputs.path = process.env['GITHUB_WORKSPACE'] || process.cwd()
  }

  if (inputs.path.startsWith(`~`)) {
    inputs.path = inputs.path.replace('~', os.homedir())
  }

  const resolvedPath = path.resolve(inputs.path)
  core.debug(`Resolved path is ${resolvedPath}`)

  const options: artifact.FindOptions = {}
  if (inputs.token) {
    const [repositoryOwner, repositoryName] = inputs.repository.split('/')
    if (!repositoryOwner || !repositoryName) {
      throw new Error(
        `Invalid repository: '${inputs.repository}'. Must be in format owner/repo`
      )
    }

    options.findBy = {
      token: inputs.token,
      workflowRunId: inputs.runID,
      repositoryName,
      repositoryOwner
    }
  }

  const artifactClient = artifact.create()
  let artifacts: artifact.Artifact[] = []

  if (inputs.name) {
    const {artifact: targetArtifact} = await artifactClient.getArtifact(
      inputs.name,
      options
    )

    if (!targetArtifact) {
      throw new Error(`Artifact '${inputs.name}' not found`)
    }

    core.debug('Found named artifact:')
    core.debug(JSON.stringify(targetArtifact, null, 2))

    artifacts = [targetArtifact]
  } else {
    const listArtifactResponse = await artifactClient.listArtifacts(options)

    if (listArtifactResponse.artifacts.length === 0) {
      throw new Error(
        `No artifacts found for run '${inputs.runID}' in '${inputs.repository}'`
      )
    }

    core.debug(`Found ${listArtifactResponse.artifacts.length} artifacts:`)
    core.debug(JSON.stringify(listArtifactResponse, null, 2))
    artifacts = listArtifactResponse.artifacts
  }

  const downloadPromises = artifacts.map(artifact =>
    artifactClient.downloadArtifact(artifact.id, {
      ...options,
      path: path.join(resolvedPath, artifact.name)
    })
  )

  const chunkedPromises = chunk(downloadPromises, PARALLEL_DOWNLOADS)
  for (const chunk of chunkedPromises) {
    await Promise.all(chunk)
  }

  core.info(`Total of ${artifacts.length} artifact(s) downloaded`)
  core.setOutput(Outputs.DownloadPath, resolvedPath)
  core.info('Download artifact has finished successfully')
}

run().catch(err =>
  core.setFailed(`Unable to download artifact(s): ${err.message}`)
)
