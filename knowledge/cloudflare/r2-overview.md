# Cloudflare R2 Overview

> Source: https://developers.cloudflare.com/r2/

## Overview

Cloudflare R2 serves as "a cost-effective, scalable object storage solution" designed for developers handling substantial unstructured data volumes. The service distinguishes itself by eliminating egress bandwidth fees typical of competing cloud storage providers.

## Primary Use Cases

R2 supports diverse storage scenarios:
- Cloud-native application data repositories
- Web content hosting
- Podcast episode storage
- Data lake infrastructure for analytics and large-scale data processing
- Machine learning artifacts and batch processing outputs

## Key Features

### Location Hints
Optional parameters configured during bucket creation allow developers to specify geographic regions where data access is anticipated, optimizing performance through strategic placement.

### CORS Configuration
Cross-Origin Resource Sharing policies enable controlled interaction with bucket objects and granular access management across different origins.

### Public Buckets
This feature exposes bucket contents directly to internet access, facilitating public content distribution without additional infrastructure.

### Bucket-Scoped Tokens
Authentication tokens with bucket-level restrictions provide fine-grained access control, allowing precise permission management across different users and applications.

## Integration Ecosystem

**Workers Integration**: Serverless execution environments enable application development and enhancement without infrastructure management overhead.

**Stream Integration**: Video processing capabilities complement storage through unified upload, encoding, and delivery services.

**Images Products**: Specialized image-processing toolsets integrate with R2 storage infrastructure.

## Resources

- [Pricing documentation](https://developers.cloudflare.com/r2/pricing)
- [Get Started guide](https://developers.cloudflare.com/r2/get-started/)
- [Code examples](https://developers.cloudflare.com/r2/examples/)
