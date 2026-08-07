export class Decode {
	private static _decoder: TextDecoder | undefined

	public static decode(buffer: Uint8Array<ArrayBuffer>) {
		if(!Decode._decoder) {
			Decode._decoder = new TextDecoder()
		}
		return Decode._decoder.decode(buffer)
	}
}