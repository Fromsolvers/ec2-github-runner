const aws = require('./aws');
const gh = require('./gh');
const config = require('./config');
const core = require('@actions/core');

function setOutput(labels, ec2InstanceIds) {
  core.setOutput('labels', JSON.stringify(labels));
  core.setOutput('ec2-instances-ids', JSON.stringify(ec2InstanceIds));
}

async function start() {
  const labels = config.getLabels()
  const githubRegistrationToken = await gh.getRegistrationToken();
  const ec2InstanceIds = await aws.startEc2Instances(labels, githubRegistrationToken);
  setOutput(labels, ec2InstanceIds);
  await aws.waitForInstancesRunning(ec2InstanceIds);
  await gh.waitForRunnersRegistered(labels);
}

async function stop() {
  await aws.terminateEc2Instances();
  await gh.removeRunners();
}

(async function () {
  try {
    config.input.mode === 'start' ? await start() : await stop();
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();