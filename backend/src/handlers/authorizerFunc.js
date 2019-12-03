"use strict";

const AWS = require("aws-sdk");
const Bluebird = require("bluebird");
AWS.config.update({ region: process.env.AWS_REGION });
AWS.config.setPromisesDependency(Bluebird);
require("aws-sdk/clients/apigatewaymanagementapi");

const jose = require("node-jose");
const fetch = require("node-fetch");
fetch.Promise = Bluebird;

exports.handler = async (event, context, callback) => {
  const keys_url =
    "https://cognito-idp.ap-southeast-2.amazonaws.com/us-east-1_ET3xSu5TZ/.well-known/jwks.json";
  const {
    queryStringParameters: { token },
    methodArn
  } = event;

  const appClientId = "app_client_id";
  if (!token) return context.fail("Unauthorized");
  const sections = token.split(".");
  let authHeader = jose.util.base64url.decode(sections[0]);
  authHeader = JSON.parse(authHeader);
  const kid = authHeader.kid;
  const rawRes = await fetch(keys_url);
  const response = await rawRes.json();

  if (rawRes.ok) {
    const keys = response["keys"];
    let key_index = -1;
    keys.some((key, index) => {
      if (kid == key.kid) {
        key_index = index;
      }
    });
    const foundKey = keys.find(key => {
      return kid === key.kid;
    });

    if (!foundKey) {
      context.fail("Public key not found in jwks.json");
    }

    jose.JWK.asKey(foundKey).then(function(result) {
      // verify the signature
      jose.JWS.createVerify(result)
        .verify(token)
        .then(function(result) {
          // now we can use the claims
          const claims = JSON.parse(result.payload);
          // additionally we can verify the token expiration
          const current_ts = Math.floor(new Date() / 1000);
          if (current_ts > claims.exp) {
            context.fail("Token is expired");
          }
          // and the Audience (use claims.client_id if verifying an access token)
          if (claims.aud != appClientId) {
            context.fail("Token was not issued for this audience");
          }
          context.succeed(generateAllow("me", methodArn));
        })
        .catch(err => {
          context.fail("Signature verification failed");
        });
    });
  }
};

const generatePolicy = function(principalId, effect, resource) {
  var authResponse = {};
  authResponse.principalId = principalId;
  if (effect && resource) {
    var policyDocument = {};
    policyDocument.Version = "2012-10-17"; // default version
    policyDocument.Statement = [];
    var statementOne = {};
    statementOne.Action = "execute-api:Invoke"; // default action
    statementOne.Effect = effect;
    statementOne.Resource = resource;
    policyDocument.Statement[0] = statementOne;
    authResponse.policyDocument = policyDocument;
  }
  return authResponse;
};

const generateAllow = function(principalId, resource) {
  return generatePolicy(principalId, "Allow", resource);
};

const generateDeny = function(principalId, resource) {
  return generatePolicy(principalId, "Deny", resource);
};
