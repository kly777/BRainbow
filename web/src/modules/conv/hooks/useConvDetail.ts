import { getConvDetailE } from "@modules/conv";
import { useParams } from "@solidjs/router";
import { createResource } from "solid-js";
import { useBackHref } from "./useBackHref.ts";

export interface ConvDetailApi {
	data: () => Awaited<ReturnType<typeof getConvDetailE>> | undefined;
	dataLoading: boolean;
	dataError: Error | undefined;
	refetch: () => void;
	backHref: () => string;
}

export function useConvDetail(): ConvDetailApi {
	const params = useParams();
	const id = () => params.id;
	const [data, { refetch }] = createResource(id, (id) =>
		getConvDetailE(Number(id)),
	);
	const backHref = useBackHref();

	return {
		data,
		get dataLoading() {
			return data.loading;
		},
		get dataError() {
			return data.error;
		},
		refetch,
		backHref,
	};
}
