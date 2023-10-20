import Q = require('q');
import tl = require('azure-pipelines-task-lib/task');
import trm = require('azure-pipelines-task-lib/toolrunner');
import fs = require('fs');
import path = require('path');
import { Package, PackageType } from './packageUtility';

var winreg = require('winreg');
var parseString = require('xml2js').parseString;
const ERROR_FILE_NAME = "error.txt";

/**
 * Constructs argument for MSDeploy command
 * 
 * @param   webAppPackage                   Web deploy package
 * @param   webAppName                      web App Name
 * @param   profile                         Azure RM Connection Details
 * @param   removeAdditionalFilesFlag       Flag to set DoNotDeleteRule rule
 * @param   excludeFilesFromAppDataFlag     Flag to prevent App Data from publishing
 * @param   takeAppOfflineFlag              Flag to enable AppOffline rule
 * @param   virtualApplication              Virtual Application Name
 * @param   setParametersFile               Set Parameter File path
 * @param   additionalArguments             Arguments provided by user
 * @param   isParamFilePresentInPacakge     Flag to check Paramter.xml file
 * @param   isFolderBasedDeployment         Flag to check if given web package path is a folder
 * @param   authType                        Type of authentication to use
 * 
 * @returns string 
 */
export function getMSDeployCmdArgs(webAppPackage: string, webAppName: string, profile,
                             removeAdditionalFilesFlag: boolean, excludeFilesFromAppDataFlag: boolean, takeAppOfflineFlag: boolean,
                             virtualApplication: string, setParametersFile: string, additionalArguments: string, isParamFilePresentInPacakge: boolean,
                             isFolderBasedDeployment: boolean, useWebDeploy: boolean, authType?: string) : string {

    var msDeployCmdArgs: string = " -verb:sync";

    var webApplicationDeploymentPath = (virtualApplication) ? webAppName + "/" + virtualApplication : webAppName;
    
    if(isFolderBasedDeployment) {
        msDeployCmdArgs += " -source:IisApp=\"'" + webAppPackage + "'\"";
        msDeployCmdArgs += " -dest:iisApp=\"'" + webApplicationDeploymentPath + "'\"";
    }
    else {
        if (webAppPackage && webAppPackage.toLowerCase().endsWith('.war')) {
            tl.debug('WAR: webAppPackage = ' + webAppPackage);
            let warFile = path.basename(webAppPackage.slice(0, webAppPackage.length - '.war'.length));
            let warExt = webAppPackage.slice(webAppPackage.length - '.war'.length)
            tl.debug('WAR: warFile = ' + warFile);
            warFile = (virtualApplication) ? warFile + "/" + virtualApplication + warExt : warFile + warExt;
            tl.debug('WAR: warFile = ' + warFile);
            msDeployCmdArgs += " -source:contentPath=\"'" + webAppPackage + "'\"";
            // tomcat, jetty location on server => /site/webapps/
            tl.debug('WAR: dest = /site/webapps/' + warFile);
            msDeployCmdArgs += " -dest:contentPath=\"'/site/webapps/" + warFile + "'\"";
        } else {
            msDeployCmdArgs += " -source:package=\"'" + webAppPackage + "'\"";

            if(isParamFilePresentInPacakge) {
                msDeployCmdArgs += " -dest:auto";
            }
            else {
                msDeployCmdArgs += " -dest:contentPath=\"'" + webApplicationDeploymentPath + "'\"";
            }
        }
    }

    if(profile != null) {
        msDeployCmdArgs += `,ComputerName=\"'https://${profile.publishUrl}/msdeploy.axd?site=${webAppName}'\",`;
        msDeployCmdArgs += `UserName=\"'${profile.userName}'\",Password=\"'${profile.userPWD}'\",AuthType=\"'${authType || "Basic"}'\"`;
    }
    
    if(isParamFilePresentInPacakge) {
        msDeployCmdArgs += " -setParam:name=\"'IIS Web Application Name'\",value=\"'" + webApplicationDeploymentPath + "'\"";
    }

    if(takeAppOfflineFlag) {
        msDeployCmdArgs += ' -enableRule:AppOffline';
    }

    if(useWebDeploy) {
        if(setParametersFile) {
            msDeployCmdArgs += " -setParamFile=" + setParametersFile + " ";
        }

        if(excludeFilesFromAppDataFlag) {
            msDeployCmdArgs += ' -skip:Directory=App_Data';
        }
    }

    additionalArguments = additionalArguments ? escapeQuotes(additionalArguments) : ' ';
    msDeployCmdArgs += ' ' + additionalArguments;

    if(!(removeAdditionalFilesFlag && useWebDeploy)) {
        msDeployCmdArgs += " -enableRule:DoNotDeleteRule";
    }

    if(profile != null)
    {
        var userAgent = tl.getVariable("AZURE_HTTP_USER_AGENT");
        if(userAgent)
        {
            msDeployCmdArgs += ' -userAgent:' + userAgent;
        }
    }

    tl.debug('Constructed msDeploy comamnd line arguments');
    return msDeployCmdArgs;
}


/**
 * Escapes quotes in a string to ensure proper command-line parsing.
 * @param {string} additionalArguments - The string to format.
 * @returns {string} The formatted string with escaped quotes.
 */
function escapeQuotes(additionalArguments: string): string {
    const parsedArgs = parseAdditionalArguments(additionalArguments);
    const separator = ",";

    const formattedArgs = parsedArgs.map(function (arg) {
        let formattedArg = '';
        let equalsSignEncountered = false;
        for (let i = 0; i < arg.length; i++) {
            const char = arg.charAt(i);
            if (char == separator && equalsSignEncountered) {
                equalsSignEncountered = false;
                arg = arg.replace(formattedArg, escapeArg(formattedArg));
                formattedArg = '';
                continue;
            }
            if (equalsSignEncountered) {
                formattedArg += char;
            } 
            if (char == '=') {
                equalsSignEncountered = true;
            } 
        };

        if (formattedArg.length > 0) {
            arg = arg.replace(formattedArg, escapeArg(formattedArg));
        }

        return arg;
    });

    return formattedArgs.join(' ');
}
exports.escapeQuotes = escapeQuotes;

/**
 * Escapes special characters in a string to ensure proper command-line parsing.
 * @param {string} arg - The string to format.
 * @returns {string} The formatted string with escaped characters.
 */
function escapeArg(arg: string): string {
    var escapedChars = new RegExp(/[\\\^\.\*\?\-\&\|\(\)\<\>\t\n\r\f]/);
    // If the argument starts with dowble quote and ends with double quote, the replace it with escaped double quotes
    if (arg.startsWith('"') && arg.endsWith('"')) {
        return '"\\' + arg.slice(0, arg.length - 1) + '\\""';
    }
    // If the argument starts with single quote and ends with single quote, then replace it with escaped double qoutes
    if (arg.startsWith("'") && arg.endsWith("'")) {
        return '"\\"' + arg.slice(1, arg.length - 1) + '\\""';
    }

    if (escapedChars.test(arg)) {
        return '"\\"' + arg + '\\""';
    }
    return arg;
}

/**
 * Parses additional arguments for the msdeploy command-line utility.
 * @param {string} additionalArguments - The additional arguments to parse.
 * @returns {string[]} An array of parsed arguments.
 */
function parseAdditionalArguments(additionalArguments: string): string[] {
    var parsedArgs = [];
    var isInsideQuotes = false;
    for (let i = 0; i < additionalArguments.length; i++) {
        var arg = '';
        var qouteSymbol = '';
        let char = additionalArguments.charAt(i);
        // command parse start
        if (char === '-') {
            while (i < additionalArguments.length) {
                char = additionalArguments.charAt(i);
                const prevSym = additionalArguments.charAt(i - 1);
                // If we reach space and we are not inside quotes, then it is the end of the argument
                if (char === ' ' && !isInsideQuotes) break;
                // If we reach unescaped comma and we inside qoutes we assume that it is the end of quoted line
                if (isInsideQuotes && char === qouteSymbol &&  prevSym !== '\\') {
                    isInsideQuotes = false;
                    qouteSymbol = '';
                // If we reach unescaped comma and we are not inside qoutes we assume that it is the beggining of quoted line
                } else if (!isInsideQuotes && (char === '"' || char === "'") &&  prevSym !== '\\') {
                    isInsideQuotes = !isInsideQuotes;
                    qouteSymbol = char;
                }

                arg += char;
                i += 1;
            }
            parsedArgs.push(arg);
        }
    }
    return parsedArgs;
}



export async function getWebDeployArgumentsString(args: WebDeployArguments): Promise<string> {
    const profile = {
        userPWD: args.password,
        userName: args.userName,
        publishUrl: args.publishUrl
    };

    return getMSDeployCmdArgs(
        args.package.getPath(),
        args.appName, 
        profile, 
        args.removeAdditionalFilesFlag,
        args.excludeFilesFromAppDataFlag,
        args.takeAppOfflineFlag,
        args.virtualApplication,
        args.setParametersFile,
        args.additionalArguments,
        await args.package.isMSBuildPackage(),
        args.package.isFolder(),
        args.useWebDeploy,
        args.authType);
}

export function shouldUseMSDeployTokenAuth(): boolean {
    return (tl.getVariable("USE_MSDEPLOY_TOKEN_AUTH") || "").toLowerCase() === "true";
}

/**
 * Gets the full path of MSDeploy.exe
 * 
 * @returns    string
 */
export async function getMSDeployFullPath(): Promise<string> {
    try {
        const msDeployInstallPathRegKey = "\\SOFTWARE\\Microsoft\\IIS Extensions\\MSDeploy";
        const msDeployLatestPathRegKey = await getMSDeployLatestRegKey(msDeployInstallPathRegKey);
        return await getMSDeployInstallPath(msDeployLatestPathRegKey) + "msdeploy.exe";
    }
    catch (error) {
        tl.debug(error);
        const subfolder = shouldUseMSDeployTokenAuth() ? "M229" : "M142";
        return path.join(__dirname, "MSDeploy", subfolder , "MSDeploy3.6", "msdeploy.exe");
    }
}

function getMSDeployLatestRegKey(registryKey: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        var regKey = new winreg({
            hive: winreg.HKLM,
            key: registryKey
        })

        regKey.keys(function (err, subRegKeys) {
            if (err) {
                reject(tl.loc("UnabletofindthelocationofMSDeployfromregistryonmachineError", err));
                return;
            }

            var latestKeyVersion = 0;
            var latestSubKey;
            for (var index in subRegKeys) {
                var subRegKey = subRegKeys[index].key;
                var subKeyVersion = subRegKey.substr(subRegKey.lastIndexOf('\\') + 1, subRegKey.length - 1);
                if (!isNaN(subKeyVersion)) {
                    var subKeyVersionNumber = parseFloat(subKeyVersion);
                    if (subKeyVersionNumber > latestKeyVersion) {
                        latestKeyVersion = subKeyVersionNumber;
                        latestSubKey = subRegKey;
                    }
                }
            }
            if (latestKeyVersion < 3) {
                reject(tl.loc("UnsupportedinstalledversionfoundforMSDeployversionshouldbeatleast3orabove", latestKeyVersion));
                return;
            }
            resolve(latestSubKey);
        });
    });
}

function getMSDeployInstallPath(registryKey: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        var regKey = new winreg({
            hive: winreg.HKLM,
            key: registryKey
        })

        regKey.values(function (err, items: { name: string, value: string }[]) {
            if (err) {
                reject(tl.loc("UnabletofindthelocationofMSDeployfromregistryonmachineError", err));
            }

            if (shouldUseMSDeployTokenAuth()) {
                const versionItem = items.find(item => item.name === "Version");
                if (!versionItem) {
                    reject(tl.loc("MissingMSDeployVersionRegistryKey"));
                }

                const minimalSupportedVersion = "9.0.7225.0";
                const version = versionItem.value;
                tl.debug(`Installed MSDeploy Version: ${version}`);

                // MSDeploy 9.0.7225.0 is the first version to support token auth
                if (compareVersions(version, minimalSupportedVersion) < 0) {
                    reject(tl.loc("UnsupportedMSDeployVersion", version));
                }
            }

            const installPathItem = items.find(item => item.name === "InstallPath");
            if (!installPathItem) {
                reject(tl.loc("MissingMSDeployInstallPathRegistryKey"));
            }

            resolve(installPathItem.value);
        });
    });
}

function compareVersions(version1: string, version2: string): number {
    if (version1 === version2) {
        return 0;
    }

    const separator = ".";
    const parts1 = version1.split(separator).map(Number);
    const parts2 = version2.split(separator).map(Number);

    const length = Math.min(parts1.length, parts2.length);

    for (let i = 0; i < length; i++) {
        if (parts1[i] > parts2[i]) {
            return 1;
        }

        if (parts1[i] < parts2[i]) {
            return -1;
        }
    }

    if (parts1.length > parts2.length) {
        return 1;
    }

    if (parts1.length < parts2.length) {
        return -1;
    }

    return 0;
}

/**
 * 1. Checks if msdeploy during execution redirected any error to 
 * error stream ( saved in error.txt) , display error to console
 * 2. Checks if there is file in use error , suggest to try app offline.
 */
export function redirectMSDeployErrorToConsole() {
    var msDeployErrorFilePath = tl.getVariable('System.DefaultWorkingDirectory') + '\\' + ERROR_FILE_NAME;
    
    if(tl.exist(msDeployErrorFilePath)) {
        var errorFileContent = fs.readFileSync(msDeployErrorFilePath).toString();

        if(errorFileContent !== "") {
            if(errorFileContent.indexOf("ERROR_INSUFFICIENT_ACCESS_TO_SITE_FOLDER") !== -1) {
                tl.warning(tl.loc("Trytodeploywebappagainwithappofflineoptionselected"));
            }
            else if(errorFileContent.indexOf("An error was encountered when processing operation 'Delete Directory' on 'D:\\home\\site\\wwwroot\\app_data\\jobs'") !== -1) {
                tl.warning(tl.loc('WebJobsInProgressIssue'));
            }
            else if(errorFileContent.indexOf("FILE_IN_USE") !== -1) {
                tl.warning(tl.loc("Trytodeploywebappagainwithrenamefileoptionselected"));
            }
            else if(errorFileContent.indexOf("transport connection") != -1){
                errorFileContent = errorFileContent + tl.loc("Updatemachinetoenablesecuretlsprotocol");
            }
          
            tl.error(errorFileContent);
        }

        tl.rmRF(msDeployErrorFilePath);
    }
}

export function getWebDeployErrorCode(errorMessage): string {
    if(errorMessage !== "") {
        if(errorMessage.indexOf("ERROR_INSUFFICIENT_ACCESS_TO_SITE_FOLDER") !== -1) {
            return "ERROR_INSUFFICIENT_ACCESS_TO_SITE_FOLDER";
        }
        else if(errorMessage.indexOf("An error was encountered when processing operation 'Delete Directory' on 'D:\\home\\site\\wwwroot\\app_data\\jobs") !== -1) {
            return "WebJobsInProgressIssue";
        }
        else if(errorMessage.indexOf("FILE_IN_USE") !== -1) {
            return "FILE_IN_USE";
        }
        else if(errorMessage.indexOf("transport connection") != -1){
            return "transport connection";
        }
        else if(errorMessage.indexOf("ERROR_CONNECTION_TERMINATED") != -1) {
            return "ERROR_CONNECTION_TERMINATED"
        }
        else if(errorMessage.indexOf("ERROR_CERTIFICATE_VALIDATION_FAILED") != -1) {
            return "ERROR_CERTIFICATE_VALIDATION_FAILED";
        }
    }

    return "";
}

export interface WebDeployArguments {
    package: Package;
    appName: string;
    publishUrl?: string;
    userName?: string;
    password?: string;
    removeAdditionalFilesFlag?: boolean;
    excludeFilesFromAppDataFlag?: boolean;
    takeAppOfflineFlag?: boolean;
    virtualApplication?: string;
    setParametersFile?: string
    additionalArguments?: string;
    useWebDeploy?: boolean;
    authType?: string;
}


export interface WebDeployResult {
    isSuccess: boolean;
    errorCode?: string;
    error?: string;
}