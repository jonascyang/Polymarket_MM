import { ChainId, OrderBuilder } from "@predictdotfun/sdk";
import { Wallet } from "ethers";

import type {
  PredictCreateOrderResponse,
  PredictRemoveOrdersResponse,
  PredictRestClient
} from "../clients/rest-client";
import type { OrderCommand } from "./order-manager";
import {
  buildLimitCreateOrderBody,
  type PredictSdkMarketMetadata
} from "./predict-sdk";

type LiveRestClient = Pick<PredictRestClient, "createOrder" | "removeOrders">;

export type PredictLiveExecutorConfig = {
  bearerToken: string;
  restClient: LiveRestClient;
  orderBuilder: OrderBuilder;
};

export type PredictLiveExecutorFactoryInput = {
  bearerToken: string;
  restClient: LiveRestClient;
  walletPrivateKey: string;
  predictAccount?: string;
  chainId?: ChainId;
};

export class PredictLiveExecutor {
  constructor(private readonly config: PredictLiveExecutorConfig) {}

  static async make(
    input: PredictLiveExecutorFactoryInput
  ): Promise<PredictLiveExecutor> {
    const wallet = new Wallet(input.walletPrivateKey);
    const orderBuilder = await OrderBuilder.make(
      input.chainId ?? ChainId.BnbMainnet,
      wallet,
      input.predictAccount
        ? {
            predictAccount: input.predictAccount
          }
        : undefined
    );

    return new PredictLiveExecutor({
      bearerToken: input.bearerToken,
      restClient: input.restClient,
      orderBuilder
    });
  }

  async createLimitOrder(
    order: Extract<OrderCommand, { type: "create" }>["order"],
    market: PredictSdkMarketMetadata
  ): Promise<PredictCreateOrderResponse> {
    const body = await buildLimitCreateOrderBody({
      orderBuilder: this.config.orderBuilder,
      order,
      market
    });
    const response = await this.config.restClient.createOrder(
      this.config.bearerToken,
      body
    );

    return response.data;
  }

  removeOrders(orderIds: string[]): Promise<PredictRemoveOrdersResponse> {
    if (orderIds.length === 0) {
      return Promise.resolve({
        success: true,
        removed: [],
        noop: []
      });
    }

    return this.config.restClient.removeOrders(this.config.bearerToken, orderIds);
  }

  async syncCommands(
    commands: OrderCommand[],
    marketsById: Record<number, PredictSdkMarketMetadata>
  ): Promise<{
    cancelled: PredictRemoveOrdersResponse;
    created: PredictCreateOrderResponse[];
  }> {
    const cancelled = await this.removeOrders(
      commands
        .filter((command): command is Extract<OrderCommand, { type: "cancel" }> => command.type === "cancel")
        .map((command) => command.orderId)
    );
    const created: PredictCreateOrderResponse[] = [];

    for (const command of commands) {
      if (command.type !== "create") {
        continue;
      }

      const market = marketsById[command.order.marketId];

      if (!market) {
        throw new Error(
          `Missing execution metadata for market ${command.order.marketId}`
        );
      }

      created.push(await this.createLimitOrder(command.order, market));
    }

    return {
      cancelled,
      created
    };
  }
}
