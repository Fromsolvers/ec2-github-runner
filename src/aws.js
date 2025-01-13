const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');

function separateArrayWithCommas(arr) {
  if (!Array.isArray(arr)) {
    return "Input is not an array";
  }

  return arr.join(",");
}
function retrieveInstanceIDsFromArrayofMaps(arrayOfMaps) {

  if (!Array.isArray(arrayOfMaps)) {
    return "Input is not an array";
  }

  // Use map() to extract the "instanceID" from each map
  const instanceIDs = arrayOfMaps.map((map) => map["InstanceId"]);

  // Filter out undefined values in case some maps don't have "instanceID"
  const filteredInstanceIDs = instanceIDs.filter((id) => id !== undefined);

  return filteredInstanceIDs;
}
// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, labels) {
  if (config.input.runnerHomeDir) {
    // If runner home directory is specified, we expect the actions-runner software (and dependencies)
    // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
    return [
      '#!/bin/bash',
      `cd "${config.input.runnerHomeDir}"`,
      `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
      'source pre-runner-script.sh',
      'export RUNNER_ALLOW_RUNASROOT=1',
      `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${separateArrayWithCommas(labels)}`,
      './run.sh',
    ];
  } else {
    return [
      '#!/bin/bash',
      'mkdir actions-runner && cd actions-runner',
      `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
      'source pre-runner-script.sh',
      'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
      'curl -O -L https://github.com/actions/runner/releases/download/v2.299.1/actions-runner-linux-${RUNNER_ARCH}-2.299.1.tar.gz',
      'tar xzf ./actions-runner-linux-${RUNNER_ARCH}-2.299.1.tar.gz',
      'export RUNNER_ALLOW_RUNASROOT=1',
      `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${separateArrayWithCommas(labels)}`,
      './run.sh',
    ];
  }
}

async function startEc2Instances(labels, githubRegistrationToken) {
  const ec2 = new AWS.EC2();

  const userData = buildUserDataScript(githubRegistrationToken, labels);

  const params = {
    ImageId: config.input.ec2ImageId,
    InstanceType: config.input.ec2InstanceType,
    KeyName: "runner-key",
    MinCount: config.input.numberOfInstances,
    MaxCount: config.input.numberOfInstances,
    UserData: Buffer.from(userData.join('\n')).toString('base64'),
    SubnetId: config.input.subnetId,
    SecurityGroupIds: [config.input.securityGroupId],
    IamInstanceProfile: { Name: config.input.iamRoleName },
    TagSpecifications: config.tagSpecifications,
  };
  core.info(`Added key pair for debugging`);
  try {
    const result = await ec2.runInstances(params).promise();
    const ec2InstanceIds = retrieveInstanceIDsFromArrayofMaps(result.Instances)
    core.info(`AWS EC2 instances ${separateArrayWithCommas(ec2InstanceIds)} are started`);
    return ec2InstanceIds;
  } catch (error) {
    core.error('AWS EC2 instances starting error');
    throw error;
  }
}

async function terminateEc2Instances() {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: config.getEc2InstanceIds(),
  };

  try {
    await ec2.terminateInstances(params).promise();
    core.info(`AWS EC2 instances ${separateArrayWithCommas(config.getEc2InstanceIds())} are terminated`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instances ${separateArrayWithCommas(config.getEc2InstanceIds())} termination error`);
    throw error;
  }
}

async function waitForInstancesRunning(ec2InstanceIds) {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: ec2InstanceIds,
  };

  try {
    await ec2.waitFor('instanceRunning', params).promise();
    core.info(`AWS EC2 instance ${separateArrayWithCommas(ec2InstanceIds)} are up and running`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${separateArrayWithCommas(ec2InstanceIds)} initialization error`);
    throw error;
  }
}

module.exports = {
  startEc2Instances,
  terminateEc2Instances,
  waitForInstancesRunning,
};
