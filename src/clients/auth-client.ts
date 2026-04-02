import { ChainId, OrderBuilder } from "@predictdotfun/sdk";
import type { PredictMmConfig } from "../types";
import { Wallet } from "ethers";
import { buildApiHeaders, type PredictApiResponse } from "./rest-client";

export type PostAuthRequest = {
  signer: string;
  signature: string;
  message: string;
};

export type AuthMessageData = {
  message: string;
};

export type AuthTokenData = {
  token: string;
};

export type PredictAuthSigner = {
  signer: string;
  signMessage: (message: string) => Promise<string>;
};

export type PredictAuthFlowClient = Pick<PredictAuthClient, "getAuthMessage" | "authenticate">;

type PredictAccountMessageSigner = Pick<OrderBuilder, "signPredictAccountMessage">;

export type CreatePredictAccountAuthSignerInput = {
  privateKey: string;
  predictAccount: string;
  chainId?: ChainId;
  builderFactory?: (input: {
    privateKey: string;
    predictAccount: string;
    chainId: ChainId;
  }) => Promise<PredictAccountMessageSigner>;
};

export function createWalletAuthSigner(privateKey: string): PredictAuthSigner {
  const wallet = new Wallet(privateKey);

  return {
    signer: wallet.address,
    signMessage(message: string) {
      return wallet.signMessage(message);
    }
  };
}

async function makePredictAccountOrderBuilder(input: {
  privateKey: string;
  predictAccount: string;
  chainId: ChainId;
}): Promise<PredictAccountMessageSigner> {
  return OrderBuilder.make(input.chainId, new Wallet(input.privateKey), {
    predictAccount: input.predictAccount
  });
}

export async function createPredictAccountAuthSigner(
  input: CreatePredictAccountAuthSignerInput
): Promise<PredictAuthSigner> {
  const builder = await (input.builderFactory ?? makePredictAccountOrderBuilder)({
    privateKey: input.privateKey,
    predictAccount: input.predictAccount,
    chainId: input.chainId ?? ChainId.BnbMainnet
  });

  return {
    signer: input.predictAccount,
    signMessage(message: string) {
      return builder.signPredictAccountMessage(message);
    }
  };
}

export async function getJwtTokenFromAuthFlow(
  client: PredictAuthFlowClient,
  signer: PredictAuthSigner
): Promise<string> {
  const authMessageResponse = await client.getAuthMessage();
  const signature = await signer.signMessage(authMessageResponse.data.message);
  const authTokenResponse = await client.authenticate({
    signer: signer.signer,
    signature,
    message: authMessageResponse.data.message
  });

  return authTokenResponse.data.token;
}

export class PredictAuthClient {
  constructor(private readonly config: PredictMmConfig) {}

  async getAuthMessage(): Promise<PredictApiResponse<AuthMessageData>> {
    const response = await fetch(`${this.config.apiBaseUrl}/auth/message`, {
      headers: buildApiHeaders(this.config.apiKey)
    });

    if (!response.ok) {
      throw new Error(`Predict auth message request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as PredictApiResponse<AuthMessageData>;
  }

  async authenticate(body: PostAuthRequest): Promise<PredictApiResponse<AuthTokenData>> {
    const response = await fetch(`${this.config.apiBaseUrl}/auth`, {
      method: "POST",
      headers: {
        ...buildApiHeaders(this.config.apiKey),
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Predict auth request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as PredictApiResponse<AuthTokenData>;
  }
}
