const core = require('@actions/core');
const github = require('@actions/github');
const _ = require('lodash');
const config = require('./config');


function separateArrayWithCommas(arr) {
  if (!Array.isArray(arr)) {
    return "Input is not an array";
  }
  // Use the join() method to concatenate array elements into a string
  return arr.join(",");
}

function areRunnersOnline(runners){
  if (runners){
    var result = true
    runners.forEach((runner) => {
      if (runner.status !== 'online'){
        result = false
      }
    });
    return result
  } else {
    return false
  }  
}

function areRunnersNotBusy(runners){
  if (runners){
    var result = true
    runners.forEach((runner) => {
      if (runner.busy){
        result = false
      }
    });
    return result
  } else {
    return false
  }  
}
// use the unique label to find the runner
// as we don't have the runner's id, it's not possible to get it in any other way
async function getRunners(multiple_labels) {
  const octokit = github.getOctokit(config.input.githubToken);

  try {
    var foundRunners = await octokit.paginate('GET /repos/{owner}/{repo}/actions/runners', config.githubContext);
    multiple_labels.forEach((label) => {
      foundRunners = _.filter(foundRunners, { labels: [{ name: label }] });
    });
    
    return foundRunners.length > 0 ? foundRunners : null;
  } catch (error) {
    return null;
  }
}

// get GitHub Registration Token for registering a self-hosted runner
async function getRegistrationToken() {
  const octokit = github.getOctokit(config.input.githubToken);

  try {
    const response = await octokit.request('POST /repos/{owner}/{repo}/actions/runners/registration-token', config.githubContext);
    core.info('GitHub Registration Token is received');
    return response.data.token;
  } catch (error) {
    core.error('GitHub Registration Token receiving error');
    throw error;
  }
}
async function removeRunners() {
  const runners = await getRunners(config.getLabels());
  const octokit = github.getOctokit(config.input.githubToken);

  // skip the runner removal process if no runners are found
  if (!runners || runners.length === 0) {
    core.info(`No GitHub self-hosted runners with labels ${separateArrayWithCommas(config.getLabels())} found, so the removal is skipped`);
    return;
  }
  // Wait until all runner are not in "online" state


  // Use Promise.all to remove runners asynchronously
  const removalPromises = runners.map(async (runner) => {
    try {
      await octokit.request('DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}', _.merge(config.githubContext, { runner_id: runner.id }));
      core.info(`GitHub self-hosted runner ${runner.name} is removed`);
    } catch (error) {
      core.error(`Error removing GitHub self-hosted runner ${runner.name}`);
      throw error;
    }
  });

  try {
    await Promise.all(removalPromises);
    core.info('All GitHub self-hosted runners are removed');
  } catch (error) {
    core.error('Error removing some GitHub self-hosted runners');
    throw error;
  }
}

async function waitForRunnersRegistered(labels) {
  const timeoutMinutes = 5;
  const retryIntervalSeconds = 10;
  const quietPeriodSeconds = 30;
  let waitSeconds = 0;

  core.info(`Waiting ${quietPeriodSeconds}s for the AWS EC2 instances to be registered in GitHub as a new self-hosted runner`);
  await new Promise(r => setTimeout(r, quietPeriodSeconds * 1000));
  core.info(`Checking every ${retryIntervalSeconds}s if the GitHub self-hosted runner is registered`);

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      const runners = await getRunners(labels);

      if (waitSeconds > timeoutMinutes * 60) {
        core.error('GitHub self-hosted runner registration error');
        clearInterval(interval);
        reject(`A timeout of ${timeoutMinutes} minutes is exceeded. Your AWS EC2 instance was not able to register itself in GitHub as a new self-hosted runner.`);
      }

      if (areRunnersOnline(runners)) {
        runners.forEach((runner, index ) => {
          core.info(`GitHub self-hosted runner number ${index}, ${runner.name}, is registered and ready to use`);
        });
        clearInterval(interval);
        resolve();
      } else {
        waitSeconds += retryIntervalSeconds;
        core.info('Checking...');
      }
    }, retryIntervalSeconds * 1000);
  });
}

async function waitForRunnersNotBusy(labels) {
  const timeoutMinutes = 5;
  const retryIntervalSeconds = 10;
  const quietPeriodSeconds = 30;
  let waitSeconds = 0;

  core.info(`Waiting ${quietPeriodSeconds}s for the AWS EC2 instances be not busy in GitHut`);
  await new Promise(r => setTimeout(r, quietPeriodSeconds * 1000));
  core.info(`Checking every ${retryIntervalSeconds}s if the GitHub self-hosted runners are not busy`);

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      const runners = await getRunners(labels);

      if (waitSeconds > timeoutMinutes * 60) {
        core.error('GitHub self-hosted runners failed to be not busy -> TIMEOUT');
        clearInterval(interval);
        reject(`A timeout of ${timeoutMinutes} minutes is exceeded. Your AWS EC2 instances were not able to be not busy.`);
      }

      if (areRunnersNotBusy(runners)) {
        runners.forEach((runner, index ) => {
          core.info(`GitHub self-hosted runner number ${index}, ${runner.name}, is not busy`);
        });
        clearInterval(interval);
        resolve();
      } else {
        waitSeconds += retryIntervalSeconds;
        core.info('Checking...');
      }
    }, retryIntervalSeconds * 1000);
  });
}

module.exports = {
  getRegistrationToken,
  waitForRunnersNotBusy,
  removeRunners,
  waitForRunnersRegistered,
};
