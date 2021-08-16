/*
 * Copyright 2021 Element Finance, Inc
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as fs from "fs";
import { ethers } from "hardhat";
import {
  getElementDeploymentAddresses,
  getBaseTokenAddress,
} from "../elf-sdk/src/helpers/getElementAddresses";
import {
  getTermTokenSymbols,
  TermTokenSymbolsResult,
} from "../elf-sdk/src/helpers/getTermTokenSymbols";
import { DeploymentAddresses } from "../elf-sdk/typechain/DeploymentAddresses";
import { getTimeUntilExpiration } from "../elf-sdk/src/helpers/getTimeUntilExpiration";
import { getLatestBlockTimestamp } from "../elf-sdk/src/helpers/getLatestBlockTimestamp";
import { getTotalSupply } from "../elf-sdk/src/helpers/getTotalSupply";
import { getReserves } from "../elf-sdk/src/helpers/getReserves";
import { getUnitSeconds } from "../elf-sdk/src/helpers/getUnitSeconds";
import { calcSpotPricePt } from "../elf-sdk/src/helpers/calcSpotPrice";
import { calcFixedAPR } from "../elf-sdk/src/helpers/calcFixedAPR";

interface Rates {
  apy: number;
  apr: number;
  tokenSymbol: string;
}

interface LoanScan {
  lendRates: Rates[];
  borrowRates: Rates[];
}

const BALANCER_VAULT_ADDRESS = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

async function generateLoanScan(terms: string[]): Promise<string> {
  const [signer] = await ethers.getSigners();

  // get the official list of Element deployed addresses.
  const deploymentAddresses: DeploymentAddresses = <DeploymentAddresses>(
    await getElementDeploymentAddresses(
      "https://raw.githubusercontent.com/element-fi/elf-deploy/main/addresses/mainnet.json"
    )
  );
  let loanScan: LoanScan = {
    lendRates: [],
    borrowRates: [],
  };
  for (const trancheListKey of terms) {
    const trancheList = deploymentAddresses.tranches[trancheListKey];
    for (const tranche of trancheList) {
      const ptPool = tranche.ptPool.address;
      const trancheAddress = tranche.address;

      // get the symbols for the term address
      const termTokenSymbols: TermTokenSymbolsResult =
        await getTermTokenSymbols(trancheAddress, signer);

      const blockTimeStamp = await getLatestBlockTimestamp();
      const timeRemainingSeconds = await getTimeUntilExpiration(
        ptPool,
        signer,
        blockTimeStamp
      );

      const base = await getBaseTokenAddress(
        deploymentAddresses,
        trancheListKey
      );

      const totalSupply = await getTotalSupply(ptPool, signer);
      let reserves = await getReserves(ptPool, BALANCER_VAULT_ADDRESS, signer);
      const ptIndex =
        reserves.tokens[0].toLowerCase() == base.toLowerCase() ? 1 : 0;
      let baseIndex =
        reserves.tokens[0].toLowerCase() == base.toLowerCase() ? 0 : 1;
      const ptReserves = reserves.balances[ptIndex];
      let baseReserves = reserves.balances[baseIndex];
      const baseDecimals = reserves.decimals[baseIndex];

      const unitSeconds = await getUnitSeconds(ptPool, signer);
      const ptSpotPrice = calcSpotPricePt(
        baseReserves.toString(),
        ptReserves.toString(),
        totalSupply.toString(),
        timeRemainingSeconds,
        unitSeconds,
        baseDecimals
      );

      const fixedAPR = calcFixedAPR(ptSpotPrice, timeRemainingSeconds) / 100;
      const rates: Rates = {
        apr: fixedAPR,
        apy: fixedAPR,
        tokenSymbol: trancheListKey.toUpperCase(),
      };

      loanScan.lendRates.push(rates);
    }
  }
  return JSON.stringify(loanScan, null, 2);
}

async function updateBucket(data: string) {
  // Load the AWS SDK for Node.js
  var AWS = require("aws-sdk");
  // Set the region
  AWS.config.update({ region: "us-east-2" });
  // Create S3 service object
  var s3 = new AWS.S3({ apiVersion: "2006-03-01" });

  // call S3 to retrieve upload file to specified bucket
  var uploadParams = { Bucket: "elementfi", Key: "", Body: "" };
  var file = "loanscan";

  // Configure the file stream and obtain the upload parameters
  var fs = require("fs");
  var fileStream = fs.createReadStream(file);
  fileStream.on("error", function (err) {
    console.log("File Error", err);
  });
  uploadParams.Body = fileStream;
  var path = require("path");
  uploadParams.Key = path.basename(file);

  // call S3 to retrieve upload file to specified bucket
  s3.upload(uploadParams, function (err, data) {
    if (err) {
      console.log("Error", err);
    }
    if (data) {
      console.log("Upload Success", data.Location);
    }
  });
}

async function setBucketPolicy() {
  var AWS = require("aws-sdk");
  // Set the region
  AWS.config.update({ region: "us-east-2" });

  // Create S3 service object
  var s3 = new AWS.S3({ apiVersion: "2006-03-01" });

  var readOnlyAnonUserPolicy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AddPerm",
        Effect: "Allow",
        Principal: "*",
        Action: ["s3:GetObject"],
        Resource: [""],
      },
    ],
  };

  // create selected bucket resource string for bucket policy
  var bucketResource = "arn:aws:s3:::elementfi/loanscan";
  readOnlyAnonUserPolicy.Statement[0].Resource[0] = bucketResource;

  // convert policy JSON into string and assign into params
  var bucketPolicyParams = {
    Bucket: "elementfi",
    Policy: JSON.stringify(readOnlyAnonUserPolicy),
  };

  // set the new policy on the selected bucket
  s3.putBucketPolicy(bucketPolicyParams, function (err, data) {
    if (err) {
      // display error message
      console.log("Error", err);
    } else {
      console.log("Success", data);
    }
  });
}

async function main() {
  const terms = ["dai"];
  const data: string = await generateLoanScan(terms);
  console.log(data);
  fs.writeFileSync("loanscan", data, "utf8");
  await updateBucket(data);
  await setBucketPolicy();
}

main();
