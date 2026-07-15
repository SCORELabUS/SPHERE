import os from 'os'
import dotenv from 'dotenv'
dotenv.config()

const appPort = process.env.SERVER_PORT || 3000

const processFileUris = (object: any, uriPropertyNames: any) => {
  
  uriPropertyNames.forEach((prop: any) => {
    if (Object.prototype.hasOwnProperty.call(object, prop) || Object.prototype.hasOwnProperty.call(object._doc ?? {}, prop)) {
      const uri = object[prop];
      if (uri && getUriType(uri) === 'relative') {
        const absoluteUri = getAbsoluteFileUri(uri);
        object[prop] = absoluteUri;
      }
    }
  });
};

const getAbsoluteFileUri = (relativeFilePath: string) => {
    let absoluteFileUrl = ''
    const addresses = getIPV4Addresses()
    if(process.env.SERVER_HOST){
      absoluteFileUrl = `${process.env.SERVER_HOST}/${relativeFilePath}`
    }else if (addresses[0]) {
      absoluteFileUrl = `http://${addresses[0]}:${appPort}/${relativeFilePath}`
    } else {
      absoluteFileUrl = `http://localhost:${appPort}/${relativeFilePath}`
    }
  
    return absoluteFileUrl
  }
  
  const getIPV4Addresses = () => {
    const interfaces = os.networkInterfaces()
    const addresses = []
  
    for (const key in interfaces) {
      for (const iface of interfaces[key] || []) {
      // Filtramos solo las direcciones IPv4 que no son de loopback
        if (iface.family === 'IPv4' && !iface.internal) {
          addresses.push(iface.address)
        }
      }
    }
    return addresses
  }
  
  function isExternalUri (uri: string) {
    const protocol = uri.split(':')[0]
    return protocol === 'http' || protocol === 'https' || protocol === 'ftp'
  }
  
  function getUriType (uri: string) {
    return isExternalUri(uri) ? 'external' : 'relative'
  }

export { processFileUris };
