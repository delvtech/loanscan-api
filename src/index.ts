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
import { getLatestBlockTimestamp } from "../elf-sdk/src/helpers/getLatestBlockTimestamp";
import { getTotalSupply } from "../elf-sdk/src/helpers/getTotalSupply";
import { getReserves } from "../elf-sdk/src/helpers/getReserves";
import { calcSpotPricePt } from "../elf-sdk/src/helpers/calcSpotPrice";
import { calcFixedAPR } from "../elf-sdk/src/helpers/calcFixedAPR";
import {
  mainnetTokenList,
  PrincipalPoolTokenInfo,
  PrincipalTokenInfo,
  TokenTag,
} from "elf-tokenlist";

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

const allUnderlyingTokens = mainnetTokenList.tokens.filter((token) =>
  token.tags.includes(TokenTag.UNDERLYING)
);
const allPrincipalTokens = mainnetTokenList.tokens.filter(
  (token): token is PrincipalTokenInfo =>
    token.tags.includes(TokenTag.PRINCIPAL)
);
const allPrincipalTokenPools = mainnetTokenList.tokens.filter(
  (token): token is PrincipalPoolTokenInfo =>
    token.tags.includes(TokenTag.CCPOOL)
);

async function generateLoanScan(terms: PrincipalTokenInfo[]): Promise<string> {
  const [signer] = await ethers.getSigners();

  const lendRates: Rates[] = await Promise.all(
    terms.map(async (principalTokenInfo): Promise<Rates> => {
      const blockTimeStamp = await getLatestBlockTimestamp();

      // principal token info
      const {
        address: principalTokenAddress,
        extensions: { underlying: baseAddress },
      } = principalTokenInfo;

      // base asset token info
      const { symbol: baseSymbol, decimals: baseDecimals } =
        allUnderlyingTokens.find((token) => token.address === baseAddress);

      // pool token info
      const {
        address: ptPoolAddress,
        extensions: { expiration, unitSeconds },
      } = allPrincipalTokenPools.find(
        (pool) => pool.extensions.bond === principalTokenAddress
      );

      const totalSupply = await getTotalSupply(ptPoolAddress, signer);

      let reserves = await getReserves(
        ptPoolAddress,
        BALANCER_VAULT_ADDRESS,
        signer
      );
      const ptIndex =
        reserves.tokens[0].toLowerCase() == baseAddress.toLowerCase() ? 1 : 0;
      let baseIndex =
        reserves.tokens[0].toLowerCase() == baseAddress.toLowerCase() ? 0 : 1;
      const ptReserves = reserves.balances[ptIndex];
      let baseReserves = reserves.balances[baseIndex];
      const timeRemainingSeconds =
        blockTimeStamp < expiration ? expiration - blockTimeStamp : 0;

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
        tokenSymbol: baseSymbol.toUpperCase(),
      };

      return rates;
    })
  );

  const loanScan: LoanScan = {
    lendRates,
    borrowRates: [],
  };

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
  // Loanscan only supports dai and usdc
  const daiTerms = allPrincipalTokens.filter(
    (token) =>
      token.extensions.underlying ===
      // mainnet dai
      "0x6B175474E89094C44Da98b954EedeAC495271d0F"
  );

  const usdcTerms = allPrincipalTokens.filter(
    (token) =>
      token.extensions.underlying ===
      // mainnet usdc
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
  );

  const data: string = await generateLoanScan([...daiTerms, ...usdcTerms]);
  console.log(data);
  fs.writeFileSync("loanscan", data, "utf8");
  await updateBucket(data);
  await setBucketPolicy();
}

main();
