<?php

namespace App\Models;

class PsgcBarangay extends PrismaModel
{
    protected $table = 'psgc_barangays';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = ['id', 'code', 'name', 'cityId'];

    public function city()
    {
        return $this->belongsTo(PsgcCity::class, 'cityId');
    }

    public function userProfiles()
    {
        return $this->hasMany(UserProfile::class, 'barangayId');
    }

    public function studyTargets()
    {
        return $this->hasMany(StudyLocationTarget::class, 'barangayId');
    }
}
