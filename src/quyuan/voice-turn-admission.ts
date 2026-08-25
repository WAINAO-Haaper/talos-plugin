export type VoiceTurnAdmissionReason =
	| "empty"
	| "inactive"
	| "navigating"
	| "busy";

export type VoiceTurnAdmission =
	| { accepted: true; text: string }
	| { accepted: false; reason: VoiceTurnAdmissionReason };

export function evaluateVoiceTurnAdmission(input: {
	text: string;
	mounted: boolean;
	navigatingToChat: boolean;
	driverBusy: boolean;
}): VoiceTurnAdmission {
	const text = input.text.trim();
	if (!text) return { accepted: false, reason: "empty" };
	if (!input.mounted) return { accepted: false, reason: "inactive" };
	if (input.navigatingToChat) {
		return { accepted: false, reason: "navigating" };
	}
	if (input.driverBusy) return { accepted: false, reason: "busy" };
	return { accepted: true, text };
}
