export interface MailServiceHost {
  sendMail(...args: any[]): Promise<any>;
  markMailRead(...args: any[]): Promise<any>;
  deleteMail(...args: any[]): Promise<any>;
  claimMail(...args: any[]): Promise<any>;
  claimAllMail(...args: any[]): Promise<any>;
  mailSummary(...args: any[]): any;
  purgeMail(...args: any[]): any;
}
export class MailService {
  constructor(private readonly host: MailServiceHost) {}
  send(...args: any[]) {
    return this.host.sendMail(...args);
  }
  markRead(...args: any[]) {
    return this.host.markMailRead(...args);
  }
  delete(...args: any[]) {
    return this.host.deleteMail(...args);
  }
  claim(...args: any[]) {
    return this.host.claimMail(...args);
  }
  claimAll(...args: any[]) {
    return this.host.claimAllMail(...args);
  }
  summary(...args: any[]) {
    return this.host.mailSummary(...args);
  }
  purge(...args: any[]) {
    return this.host.purgeMail(...args);
  }
}
