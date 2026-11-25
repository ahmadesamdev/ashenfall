export interface ClientSessionControllerOptions {
  setResolved: (value: boolean) => void;
  setLoading: (show: boolean, text?: string) => void;
  setCreatingCharacterVisible: (visible: boolean) => void;
}

export class ClientSessionController {
  constructor(private readonly o: ClientSessionControllerOptions) {}

  resolve(hasCharacter: boolean): void {
    this.o.setResolved(true);
    this.o.setLoading(false);
    this.o.setCreatingCharacterVisible(!hasCharacter);
  }
}
