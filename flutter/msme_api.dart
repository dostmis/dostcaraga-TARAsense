import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tarasense_mobile/core/network/api_client.dart';
import 'package:tarasense_mobile/features/auth/state/auth_providers.dart';
import 'package:tarasense_mobile/features/msme/domain/msme_models.dart';

class MsmeApi {
  MsmeApi(this._client);

  final ApiClient _client;

  Future<MsmeDashboardData> fetchDashboard(
    String accessToken, {
    String? query,
  }) async {
    final response = await _client.getJson(
      '/msme/dashboard',
      bearerToken: accessToken,
      queryParameters: (query ?? '').trim().isEmpty
          ? null
          : <String, dynamic>{'q': query!.trim()},
    );
    return MsmeDashboardData.fromJson(response);
  }

  Future<StudyBuilderOptionsData> fetchStudyBuilderOptions(
    String accessToken,
  ) async {
    final response = await _client.getJson(
      '/msme/study-builder-options',
      bearerToken: accessToken,
    );
    return StudyBuilderOptionsData.fromJson(response);
  }

  Future<Map<String, dynamic>> createStudy(
    String accessToken, {
    required Map<String, dynamic> payload,
  }) {
    return _client.postJson(
      '/msme/studies',
      bearerToken: accessToken,
      data: payload,
    );
  }

  Future<MsmeProfileData> fetchProfile(String accessToken) async {
    final response = await _client.getJson(
      '/profile',
      bearerToken: accessToken,
    );
    return MsmeProfileData.fromJson(response);
  }

  Future<MsmeProfileData> updateProfile(
    String accessToken, {
    required Map<String, dynamic> payload,
  }) async {
    final response = await _client.patchJson(
      '/profile',
      bearerToken: accessToken,
      data: payload,
    );
    return MsmeProfileData.fromJson(response);
  }
}

final msmeApiProvider = Provider<MsmeApi>((ref) {
  return MsmeApi(ref.watch(apiClientProvider));
});
